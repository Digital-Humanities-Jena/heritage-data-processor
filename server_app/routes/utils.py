# server_app/routes/utils.py
import difflib
import json
import logging
import re
from pathlib import Path
import yaml
import pandas as pd
import traceback

from flask import Blueprint, jsonify, request

# These imports are for specific utility functions.
# Do not forget to run / suggest `pip install lxml python-magic`
# The ollama import will only work if the library is installed.
try:
    import ollama

    OLLAMA_AVAILABLE = True
except ImportError:
    OLLAMA_AVAILABLE = False
try:
    from lxml import etree

    LXML_AVAILABLE = True
except ImportError:
    LXML_AVAILABLE = False


utils_bp = Blueprint("utils_bp", __name__)
logger = logging.getLogger(__name__)


@utils_bp.route("/utils/get_yaml_keys", methods=["POST"])
def get_yaml_keys():
    """Parses a YAML file and returns its top-level or sub-level keys."""
    try:
        data = request.get_json()
        file_path_str = data.get("file_path")
        parent_key = data.get("parent_key")
        if not file_path_str or not Path(file_path_str).exists():
            return jsonify({"error": "File not found"}), 404

        with open(file_path_str, "r", encoding="utf-8") as f:
            yaml_data = yaml.safe_load(f)

        if parent_key:
            keys = list(yaml_data.get(parent_key, {}).keys())
        else:
            all_keys = list(yaml_data.keys())
            keys_to_exclude = {"settings", "version", "sources"}
            keys = [key for key in all_keys if key not in keys_to_exclude]
        return jsonify({"keys": keys})
    except Exception as e:
        logger.error(f"Error in get_yaml_keys: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@utils_bp.route("/utils/get_table_headers", methods=["POST"])
def get_table_headers_route():
    """Reads a CSV or Excel file and returns its column headers."""
    data = request.get_json()
    file_path_str = data.get("file_path")
    if not file_path_str or not Path(file_path_str).exists():
        return jsonify({"success": False, "error": "File not found"}), 404

    try:
        path = Path(file_path_str)
        if path.suffix.lower() in {".xls", ".xlsx"}:
            df = pd.read_excel(path, engine="openpyxl")
        elif path.suffix.lower() == ".tsv":
            df = pd.read_csv(path, sep="\t")
        else:
            df = pd.read_csv(path)
        return jsonify({"success": True, "headers": list(df.columns)})
    except Exception as e:
        logger.error(f"Error in get_table_headers: {e}", exc_info=True)
        return jsonify({"success": False, "error": f"Failed to read file: {str(e)}"}), 500


@utils_bp.route("/utils/list_ollama_models", methods=["GET"])
def list_ollama_models():
    """Lists available Ollama models, handling connection errors."""
    if not OLLAMA_AVAILABLE:
        return jsonify({"success": False, "error": "Ollama library not installed on the server."})
    try:
        models = ollama.list()["models"]
        model_names = [m["name"] for m in models]
        return jsonify({"success": True, "models": model_names})
    except Exception as e:
        return jsonify({"success": False, "error": "Ollama not reachable.", "details": str(e)})


@utils_bp.route("/utils/get_prompt_placeholders", methods=["POST"])
def get_prompt_placeholders():
    """Parses a YAML file and finds all unique {placeholder} strings."""
    data = request.get_json()
    file_path, prompt_id = data.get("file_path"), data.get("prompt_id")
    if not all([file_path, prompt_id]) or not Path(file_path).exists():
        return jsonify({"error": "File path or prompt ID missing or invalid"}), 400

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            yaml_data = yaml.safe_load(f)

        prompts = yaml_data.get(prompt_id, {})
        all_text = " ".join(
            v.get("system", "") + " " + v.get("user", "") for v in prompts.values() if isinstance(v, dict)
        )
        placeholders = sorted(list(set(re.findall(r"\{(\w+)\}", all_text))))
        return jsonify({"success": True, "placeholders": placeholders})
    except Exception as e:
        logger.error(f"Error in get_prompt_placeholders: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@utils_bp.route("/utils/automap_zenodo_fields", methods=["POST"])
def automap_zenodo_fields_route():
    """Analyzes column headers and suggests mappings to Zenodo metadata fields."""
    data = request.get_json()
    headers = data.get("headers", [])
    if not headers:
        return jsonify({"success": False, "error": "No headers provided"}), 400

    ZENODO_MAPPING_KEYWORDS = {
        "title": ["title", "headline", "name"],
        "description": ["description", "summary", "abstract"],
        "creators": ["author", "creator", "artist", "writer"],
        "publication_date": ["date", "publicationdate", "pub_date", "year"],
        "keywords": ["keywords", "tags", "subjects"],
    }

    def normalize(s):
        return s.lower().replace("_", "").replace(" ", "")

    automapping = {}
    used_headers = set()

    # Level 1: Keyword-based matching
    for zenodo_field, keywords in ZENODO_MAPPING_KEYWORDS.items():
        for header in headers:
            if header not in used_headers and normalize(header) in keywords:
                automapping[zenodo_field] = header
                used_headers.add(header)
                break

    # Level 2: Similarity-based matching for remaining fields
    remaining_fields = [f for f in ZENODO_MAPPING_KEYWORDS if f not in automapping]
    available_headers = [h for h in headers if h not in used_headers]

    for field in remaining_fields:
        best_match = max(
            available_headers,
            key=lambda h: difflib.SequenceMatcher(None, normalize(field), normalize(h)).ratio(),
            default=None,
        )
        if best_match and difflib.SequenceMatcher(None, normalize(field), normalize(best_match)).ratio() > 0.8:
            automapping[field] = best_match
            used_headers.add(best_match)
            available_headers.remove(best_match)

    return jsonify({"success": True, "mapping": automapping})


@utils_bp.route("/utils/preview_spreadsheet", methods=["POST"])
def preview_spreadsheet_route():
    data = request.get_json()
    file_path_str = data.get("filePath")
    if not file_path_str or not Path(file_path_str).is_file():
        return jsonify({"success": False, "error": "File not found"}), 404

    try:
        df = pd.read_excel(file_path_str) if file_path_str.endswith((".xls", ".xlsx")) else pd.read_csv(file_path_str)
        return jsonify(
            {
                "success": True,
                "columns": list(df.columns),
                "previewData": df.head(5).to_dict(orient="records"),
            }
        )
    except Exception as e:
        logger.error(f"Error in preview_spreadsheet: {e}", exc_info=True)
        return jsonify({"success": False, "error": f"Error reading file: {str(e)}"}), 500


@utils_bp.route("/utils/get_json_keys", methods=["POST"])
def get_json_keys():
    """Parses a JSON file and returns its top-level keys."""
    data = request.get_json()
    file_path_str = data.get("file_path")

    if not file_path_str:
        return jsonify({"success": False, "error": "file_path is required."}), 400

    file_path = Path(file_path_str)
    if not file_path.is_file():
        return jsonify({"success": False, "error": f"File not found: {file_path_str}"}), 404

    try:
        with file_path.open("r", encoding="utf-8") as f:
            json_data = json.load(f)

        if not isinstance(json_data, dict):
            return jsonify({"success": False, "error": "The provided file is not a JSON object (dictionary)."}), 400

        keys = sorted(list(json_data.keys()))
        return jsonify({"success": True, "keys": keys})

    except json.JSONDecodeError:
        return jsonify({"success": False, "error": "Invalid JSON format in the file."}), 500
    except Exception as e:
        logging.error(f"Failed to get JSON keys from {file_path_str}: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


def _parse_all_schemas(schema_dir: Path) -> (dict, dict, dict):  # type: ignore
    """
    Parses all .xsd files in a directory to build maps of simpleTypes,
    element-to-type mappings, and namespace prefixes.
    """
    type_definitions = {}
    element_to_type_map = {}
    ns = {"xs": "http://www.w3.org/2001/XMLSchema"}
    PREFIX_MAP = {
        "dc": "http://purl.org/dc/elements/1.1/",
        "edm": "http://www.europeana.eu/schemas/edm/",
        "dcterms": "http://purl.org/dc/terms/",
        "skos": "http://www.w3.org/2004/02/skos/core#",
    }

    if not LXML_AVAILABLE:
        logger.warning("lxml is not installed. Cannot parse XML schemas.")
        return type_definitions, element_to_type_map, PREFIX_MAP

    for schema_file in schema_dir.glob("*.xsd"):
        try:
            doc = etree.parse(str(schema_file))
            target_namespace = doc.getroot().get("targetNamespace", "")

            # Find all named simpleTypes with enumerations
            for simple_type_node in doc.xpath(".//xs:simpleType[@name]", namespaces=ns):
                type_name = simple_type_node.get("name")
                enums = simple_type_node.xpath("./xs:restriction/xs:enumeration", namespaces=ns)
                if enums:
                    type_definitions[type_name] = [e.get("value") for e in enums]

            # Find all element definitions and map them to their type
            for element_node in doc.xpath(".//xs:element[@name]", namespaces=ns):
                element_name = element_node.get("name")
                element_type_name = element_node.get("type")
                if element_name and element_type_name:
                    clean_type_name = element_type_name.split(":")[-1]
                    full_element_name = f"{{{target_namespace}}}{element_name}"
                    element_to_type_map[full_element_name] = clean_type_name

        except etree.XMLSyntaxError as e:
            logger.warning(f"Could not parse schema file {schema_file.name}: {e}")
            continue

    return type_definitions, element_to_type_map, PREFIX_MAP


@utils_bp.route("/utils/get_template_mapping_info", methods=["POST"])
def get_template_mapping_info():
    """
    Analyzes a template file against a directory of schemas to provide the frontend
    with all necessary info to build the mapping modal, including controlled vocabularies.
    """
    try:
        data = request.get_json()
        schema_dir_path = data.get("schema_dir")
        template_file_path = data.get("template_file")

        if not all([schema_dir_path, template_file_path]):
            return jsonify({"success": False, "error": "schema_dir and template_file are required."}), 400

        # Step 1: Parse all schemas to build our data model
        type_definitions, element_to_type_map, prefix_map = _parse_all_schemas(Path(schema_dir_path))

        # Step 2: Extract variables from the user's template
        with open(template_file_path, "r", encoding="utf-8") as f:
            content = f.read()

        # Regex to find ${variable_name}
        template_vars = sorted(list(set(re.findall(r"\$\{([a-zA-Z0-9_]+)\}", content))))

        # Step 3: Correlate template variables with schema info
        results = []
        for var in template_vars:
            info = {"name": var, "has_vocab": False, "vocab_values": []}

            # Heuristic to split variable like "dc_creator" into "dc" and "creator"
            if "_" in var:
                prefix, local_name = var.split("_", 1)
                if prefix in prefix_map:
                    namespace = prefix_map[prefix]
                    full_element_name = f"{{{namespace}}}{local_name}"

                    # Look up the element's type
                    element_type_name = element_to_type_map.get(full_element_name)
                    if element_type_name:
                        # Look up the type's vocabulary
                        vocab_values = type_definitions.get(element_type_name)
                        if vocab_values:
                            info["has_vocab"] = True
                            info["vocab_values"] = vocab_values

            results.append(info)

        return jsonify({"success": True, "variables": results})

    except Exception as e:
        logging.error(f"Failed to get template mapping info: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@utils_bp.route("/utils/automap_columns", methods=["POST"])
def automap_columns_route():
    """
    Analyzes prompt placeholders and table headers to generate a best-guess mapping
    using a layered, intelligent matching algorithm.
    """
    # Compile regex once at function level for efficiency
    if not hasattr(automap_columns_route, "_placeholder_pattern"):
        automap_columns_route._placeholder_pattern = re.compile(r"\{(\w+)\}")

    try:
        data = request.get_json()
        table_path = data.get("table_path")
        prompts_path = data.get("prompts_path")
        prompt_id = data.get("prompt_id")

        if not all([table_path, prompts_path, prompt_id]):
            return jsonify({"error": "Missing required paths or prompt ID"}), 400

        # --- Get Placeholders ---
        with open(prompts_path, "r", encoding="utf-8") as f:
            yaml_data = yaml.safe_load(f)

        if prompt_id not in yaml_data:
            return jsonify({"success": True, "mapping": {}})

        # Optimize text concatenation using join
        text_parts = []
        for value in yaml_data[prompt_id].values():
            if isinstance(value, dict):
                text_parts.extend([value.get("system", ""), value.get("user", "")])
        all_text = " ".join(text_parts)

        placeholders = sorted(list(set(automap_columns_route._placeholder_pattern.findall(all_text))))

        # Early return if no placeholders found
        if not placeholders:
            return jsonify({"success": True, "mapping": {}})

        # --- Get Table Headers ---
        path = Path(table_path)

        if path.suffix.lower() in {".xls", ".xlsx"}:
            df = pd.read_excel(table_path, engine="openpyxl")
        else:
            df = pd.read_csv(table_path)

        headers = list(df.columns)

        # Early return if no headers found
        if not headers:
            return jsonify({"error": "No headers found in table"}), 400

        # --- Intelligent Automapping ---
        automapping = {}
        used_headers = set()

        def normalize(s):
            """Normalize text for comparison by converting to lowercase and removing spaces/underscores."""
            return s.lower().replace("_", "").replace(" ", "")

        # Pre-normalize all strings once for efficiency
        normalized_headers = {header: normalize(header) for header in headers}
        normalized_placeholders = {ph: normalize(ph) for ph in placeholders}

        # --- Level 1 & 2: Exact and Normalized Matches ---
        for ph in placeholders:
            ph_norm = normalized_placeholders[ph]

            # Check exact match first (most efficient)
            if ph in headers and ph not in used_headers:
                automapping[ph] = ph
                used_headers.add(ph)
                continue

            # Check normalized match
            for header in headers:
                if header in used_headers:
                    continue
                if ph_norm == normalized_headers[header]:
                    automapping[ph] = header
                    used_headers.add(header)
                    break

        # --- Level 3: Plural/Singular Matches ---
        remaining_placeholders = [p for p in placeholders if p not in automapping]
        for ph in remaining_placeholders:
            ph_norm = normalized_placeholders[ph]
            available_headers = [h for h in headers if h not in used_headers]

            for header in available_headers:
                header_norm = normalized_headers[header]
                # Check for simple plural/singular forms
                if f"{ph_norm}s" == header_norm or ph_norm == f"{header_norm}s":
                    automapping[ph] = header
                    used_headers.add(header)
                    break

        # --- Level 4: Similarity-Based Matching ---
        remaining_placeholders = [p for p in placeholders if p not in automapping]
        SIMILARITY_THRESHOLD = 0.8  # High threshold to avoid poor matches

        for ph in remaining_placeholders:
            ph_norm = normalized_placeholders[ph]
            available_headers = [h for h in headers if h not in used_headers]

            best_match = None
            highest_score = SIMILARITY_THRESHOLD

            for header in available_headers:
                header_norm = normalized_headers[header]
                score = difflib.SequenceMatcher(None, ph_norm, header_norm).ratio()
                if score > highest_score:
                    highest_score = score
                    best_match = header

            if best_match:
                automapping[ph] = best_match
                used_headers.add(best_match)

        return jsonify({"success": True, "mapping": automapping})

    except FileNotFoundError as e:
        logging.error(f"File not found: {e}")
        return jsonify({"success": False, "error": f"File not found: {e}"}), 404
    except yaml.YAMLError as e:
        logging.error(f"YAML parsing error: {e}")
        return jsonify({"success": False, "error": f"Invalid YAML format: {e}"}), 400
    except pd.errors.EmptyDataError as e:
        logging.error(f"Empty data file: {e}")
        return jsonify({"success": False, "error": "Table file is empty"}), 400
    except Exception as e:
        logging.error(f"Automapping failed: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


@utils_bp.route("/utils/get_prompt_content", methods=["POST"])
def get_prompt_content():
    """Retrieves system/user prompts and a suggested model from a prompts file."""
    try:
        data = request.get_json()
        file_path = data.get("file_path")
        prompt_id = data.get("prompt_id")
        prompt_key = data.get("prompt_key")

        if not all([file_path, prompt_id, prompt_key]):
            return jsonify({"error": "Missing required fields"}), 400

        with open(file_path, "r", encoding="utf-8") as f:
            yaml_data = yaml.safe_load(f)

        prompt_section = yaml_data.get(prompt_id, {}).get(prompt_key, {})

        return jsonify(
            {
                "success": True,
                "system": prompt_section.get("system", "Not defined."),
                "user": prompt_section.get("user", "Not defined."),
                "suggested_model": prompt_section.get("model"),
            }
        )
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@utils_bp.route("/utils/get_template_variables", methods=["POST"])
def get_template_variables():
    """Parses a file and returns all unique ${variable} or {variable} placeholders."""
    try:
        data = request.get_json()
        file_path_str = data.get("file_path")

        if not file_path_str or not Path(file_path_str).exists():
            return jsonify({"error": "File not found or path not provided"}), 404

        with open(file_path_str, "r", encoding="utf-8") as f:
            content = f.read()

        placeholders = set(re.findall(r"\{(\w+)\}", content))
        cleaned_placeholders = sorted(list(placeholders))

        return jsonify({"success": True, "variables": cleaned_placeholders})
    except Exception as e:
        logging.error(f"Failed to get template variables: {e}")
        return jsonify({"success": False, "error": str(e)}), 500
