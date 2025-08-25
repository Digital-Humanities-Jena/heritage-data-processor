# server_app/utils/component_utils.py
import json
import logging
from pathlib import Path
import requests
import time
from typing import Any, Dict, List, Optional, Union
from urllib.parse import urljoin
import yaml

logger = logging.getLogger(__name__)


def scan_local_pipeline_components(output: Optional[str] = None, verbose: bool = False) -> None:
    """
    Scans for component.yaml files in pipeline_components subdirectories and extracts metadata.

    Args:
        output: Optional custom output file path. If None, uses default path.
        verbose: If True, prints the complete JSON output in readable format.
    """
    if output is None:
        output = "./server_app/data/component_versions.json"

    components_dir = Path("./pipeline_components")
    output_path = Path(output)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    components_data = {}

    # Check if components directory exists
    if not components_dir.exists():
        print(f"Warning: Components directory '{components_dir}' does not exist.")
        # Write empty JSON file
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump({}, f, indent=2)
        return

    # Scan for component.yaml files in subdirectories
    for subdir in components_dir.iterdir():
        if not subdir.is_dir():
            continue

        component_yaml = subdir / "component.yaml"

        if not component_yaml.exists():
            if verbose:
                print(f"No component.yaml found in {subdir.name}")
            continue

        try:
            # Parse YAML file
            with open(component_yaml, "r", encoding="utf-8") as f:
                component_data = yaml.safe_load(f)

            # Extract metadata
            metadata = component_data.get("metadata", {})
            component_name = metadata.get("name")

            if not component_name:
                print(f"Warning: No name found in metadata for {component_yaml}")
                continue

            # Check if 'env' directory exists at same level as component.yaml
            env_dir = subdir / "env"
            local_state = "installed" if env_dir.exists() else "not_installed"

            # Build component entry
            components_data[component_name] = {
                "updated": metadata.get("updated", ""),
                "version": metadata.get("version", ""),
                "local_state": local_state,
            }

            if verbose:
                print(f"Processed component: {component_name} ({local_state})")

        except yaml.YAMLError as e:
            print(f"Error parsing YAML file {component_yaml}: {e}")
        except Exception as e:
            print(f"Error processing {component_yaml}: {e}")

    # Write results to JSON file
    try:
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(components_data, f, indent=2, ensure_ascii=False)

        print(f"Component versions written to: {output_path}")
        print(f"Found {len(components_data)} components")

    except Exception as e:
        print(f"Error writing output file {output_path}: {e}")
        return

    # Print JSON if verbose mode is enabled
    if verbose:
        print("\nComplete JSON output:")
        print(json.dumps(components_data, indent=2, ensure_ascii=False))


def fetch_zenodo_community_components(
    community_id: str = "hdp-components", output: Optional[str] = None, verbose: bool = False
) -> None:
    """
    Fetches all records from a Zenodo community and extracts component metadata.

    Args:
        community_id: Zenodo community identifier
        output: Optional custom output file path. If None, uses default path.
        verbose: If True, prints detailed processing information.
    """
    if output is None:
        output = "./server_app/data/zenodo_components.json"

    output_path = Path(output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Expected file structure
    expected_files = [
        "CHANGELOG.md",
        "component_basic.zip",
        "component_complete.zip",
        "component.yaml",
        "processor.py",
        "main.py",
        "requirements.txt",
    ]

    session = requests.Session()
    session.headers.update({"User-Agent": "HDPComponentsScanner/1.0"})

    components_data = {}

    try:
        # Fetch all records from the community
        records = _fetch_all_community_records(session, community_id, verbose)

        if verbose:
            print(f"Found {len(records)} records in community '{community_id}'")

        for record in records:
            try:
                component_data = _process_record(session, record, expected_files, verbose)
                if component_data:
                    component_name = component_data.pop("component_name")
                    components_data[component_name] = component_data

            except Exception as e:
                print(f"Error processing record {record.get('id', 'unknown')}: {e}")
                continue

        # Write results to JSON file
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(components_data, f, indent=2, ensure_ascii=False)

        print(f"Zenodo components data written to: {output_path}")
        print(f"Processed {len(components_data)} components")

        if verbose:
            print("\nComplete JSON output:")
            print(json.dumps(components_data, indent=2, ensure_ascii=False))

    except Exception as e:
        print(f"Error fetching community data: {e}")
        # Write empty JSON on error
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump({}, f, indent=2)

    finally:
        session.close()


def _fetch_all_community_records(session: requests.Session, community_id: str, verbose: bool) -> List[Dict[str, Any]]:
    """Fetch all records from a Zenodo community with pagination support."""

    all_records = []
    page = 1
    page_size = 100  # Maximum allowed by Zenodo

    while True:
        if verbose:
            print(f"Fetching page {page}...")

        # Use search API to get community records
        url = "https://zenodo.org/api/records"
        params = {"communities": community_id, "page": page, "size": page_size, "sort": "newest"}

        response = session.get(url, params=params)
        response.raise_for_status()

        data = response.json()
        records = data.get("hits", {}).get("hits", [])

        if not records:
            break

        all_records.extend(records)

        # Check if there are more pages
        total = data.get("hits", {}).get("total", 0)
        if len(all_records) >= total:
            break

        page += 1

        time.sleep(0.5)

    return all_records


def _process_record(
    session: requests.Session, record: Dict[str, Any], expected_files: List[str], verbose: bool
) -> Optional[Dict[str, Any]]:
    """Process a single Zenodo record and extract component metadata."""

    metadata = record.get("metadata", {})
    files = record.get("files", [])

    # Extract basic record information
    record_id = record.get("id")
    doi = metadata.get("doi", "")
    concept_doi = metadata.get("relations", {}).get("version", [{}])[0].get("parent", {}).get("pid_value", "")
    if concept_doi:
        concept_doi = f"10.5281/zenodo.{concept_doi}"

    record_url = f"https://zenodo.org/records/{record_id}"

    if verbose:
        print(f"Processing record {record_id}: {metadata.get('title', 'Untitled')}")

    # Create file links mapping
    file_links = {}
    file_found = {filename: False for filename in expected_files}

    for file_info in files:
        filename = file_info.get("key", "")
        if filename in expected_files:
            file_links[filename] = file_info.get("links", {}).get("self", "")
            file_found[filename] = True

    # Check if we have the essential files
    if not file_found.get("component.yaml", False):
        if verbose:
            print(f"  Skipping record {record_id}: No component.yaml found")
        return None

    # Download and parse component.yaml to get component name
    try:
        component_yaml_url = file_links["component.yaml"]
        yaml_response = session.get(component_yaml_url)
        yaml_response.raise_for_status()

        component_config = yaml.safe_load(yaml_response.text)
        component_name = component_config.get("metadata", {}).get("name")

        if not component_name:
            if verbose:
                print(f"  Skipping record {record_id}: No component name in metadata")
            return None

    except Exception as e:
        if verbose:
            print(f"  Error parsing component.yaml for record {record_id}: {e}")
        return None

    # Extract version and updated info from component.yaml
    component_metadata = component_config.get("metadata", {})
    version = component_metadata.get("version", "")
    updated = component_metadata.get("updated", "")

    # Build the result
    result = {
        "component_name": component_name,
        "updated": updated,
        "version": version,
        "doi": doi,
        "concept_doi": concept_doi,
        "record_url": record_url,
        "file_links": file_links,
        "missing_files": [f for f, found in file_found.items() if not found],
    }

    if verbose:
        print(f"  Successfully processed: {component_name} v{version}")
        if result["missing_files"]:
            print(f"    Missing files: {', '.join(result['missing_files'])}")

    time.sleep(0.5)

    return result
