from datetime import datetime
import requests
import yaml
import time
from typing import Dict, List, Optional, Any
import logging

logger = logging.getLogger(__name__)


class ZenodoService:
    def __init__(self, community_id: str, user_agent: str, timeout: int = 30):
        self.community_id = community_id
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": user_agent})

        self.expected_files = [
            "CHANGELOG.md",
            "component_basic.zip",
            "component_complete.zip",
            "component.yaml",
            "processor.py",
            "main.py",
            "requirements.txt",
        ]

    def fetch_community_components(self) -> Dict[str, Any]:
        """Fetch all components from the Zenodo community with enhanced structure."""
        try:
            logger.info(f"Fetching components from community: {self.community_id}")

            records = self._fetch_all_community_records()
            components_by_identifier = {}  # Group by component name
            categories = {}  # Track categories

            logger.info(f"Found {len(records)} records in community")

            for record in records:
                try:
                    component_data = self._process_record(record)
                    if component_data:
                        component_name = component_data.pop("component_name")
                        category = component_data.get("category", "Uncategorized")

                        # Group by component identifier
                        if component_name not in components_by_identifier:
                            components_by_identifier[component_name] = []

                        components_by_identifier[component_name].append(component_data)

                        # Track categories
                        if category not in categories:
                            categories[category] = {"count": 0, "identifiers": []}

                        if component_name not in categories[category]["identifiers"]:
                            categories[category]["identifiers"].append(component_name)
                            categories[category]["count"] = len(categories[category]["identifiers"])

                        logger.debug(
                            f"Processed component: {component_name} v{component_data.get('version', 'unknown')}"
                        )

                except Exception as e:
                    logger.error(f"Error processing record {record.get('id', 'unknown')}: {e}")
                    continue

            # Sort versions within each component (newest first)
            for component_name, versions in components_by_identifier.items():
                versions.sort(key=lambda x: x.get("updated", ""), reverse=True)

            # Build final structure with metadata
            result = {"metadata": {"retrieved": datetime.utcnow().isoformat() + "Z", "categories": categories}}
            result.update(components_by_identifier)

            logger.info(
                f"Successfully processed {len(components_by_identifier)} unique components with {sum(len(v) for v in components_by_identifier.values())} total versions"
            )
            return result

        except Exception as e:
            logger.error(f"Error fetching community data: {e}")
            raise
        finally:
            self.session.close()

    def _fetch_all_community_records(self) -> List[Dict[str, Any]]:
        """Fetch all records from the Zenodo community with pagination."""
        all_records = []
        page = 1
        page_size = 100

        while True:
            logger.debug(f"Fetching page {page}...")

            url = "https://zenodo.org/api/records"
            params = {"communities": self.community_id, "page": page, "size": page_size, "sort": "newest"}

            response = self.session.get(url, params=params, timeout=self.timeout)
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

    def _process_record(self, record: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Process a single Zenodo record and extract component metadata."""
        metadata = record.get("metadata", {})
        files = record.get("files", [])

        record_id = record.get("id")
        doi = metadata.get("doi", "")

        # Extract concept DOI
        concept_doi = ""
        relations = metadata.get("relations", {})
        if "version" in relations:
            for version_info in relations["version"]:
                if version_info.get("is_last", False):
                    parent = version_info.get("parent", {})
                    if "pid_value" in parent:
                        concept_doi = f"10.5281/zenodo.{parent['pid_value']}"
                    break

        record_url = f"https://zenodo.org/records/{record_id}"

        # Create file links mapping
        file_links = {}
        file_found = {filename: False for filename in self.expected_files}

        for file_info in files:
            filename = file_info.get("key", "")
            if filename in self.expected_files:
                file_links[filename] = file_info.get("links", {}).get("self", "")
                file_found[filename] = True

        # Check if we have component.yaml
        if not file_found.get("component.yaml", False):
            logger.debug(f"Skipping record {record_id}: No component.yaml found")
            return None

        # Download and parse component.yaml
        try:
            component_yaml_url = file_links["component.yaml"]
            yaml_response = self.session.get(component_yaml_url, timeout=self.timeout)
            yaml_response.raise_for_status()

            component_config = yaml.safe_load(yaml_response.text)
            component_metadata = component_config.get("metadata", {})
            component_name = component_metadata.get("name")

            if not component_name:
                logger.debug(f"Skipping record {record_id}: No component name in metadata")
                return None

        except Exception as e:
            logger.error(f"Error parsing component.yaml for record {record_id}: {e}")
            return None

        result = {
            "component_name": component_name,
            "updated": component_metadata.get("updated", ""),
            "version": component_metadata.get("version", ""),
            "category": component_metadata.get("category", "Uncategorized"),
            "label": component_metadata.get("label", component_name),
            "description": component_metadata.get("description", ""),
            "status": component_metadata.get("status", "unknown"),
            "authors": component_metadata.get("authors", []),
            "doi": doi,
            "concept_doi": concept_doi,
            "record_url": record_url,
            "file_links": file_links,
            "missing_files": [f for f, found in file_found.items() if not found],
        }

        time.sleep(0.5)
        return result
