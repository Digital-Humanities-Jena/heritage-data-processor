# [**Version 0.1.0-alpha.3 (2025-09-01)**](https://github.com/Digital-Humanities-Jena/heritage-data-processor/releases/tag/v0.1.0-alpha.3)

### Major:
- Implemented 3D Model Modality Template, including complex validation mechanisms and file overviews during project creation
- Updated system to assign source and associated files to record entities

# [**Version 0.1.0-alpha.2 (2025-08-29)**](https://github.com/Digital-Humanities-Jena/heritage-data-processor/releases/tag/v0.1.0-alpha.2)

### Major:
- Implemented **HDP Component Retrieval & Registration System**
- Added basic HDP Components to newly created Zenodo Community [Heritage Data Processor Components](https://zenodo.org/communities/hdp-components)
- Added Server Application / Container for API Handling in `./containers/hdp-components-api`
- Added API endpoints: Pipeline Component Retrieval (https://api.modavis.org/hdp/v1/available-components \[GET\]) and Registration (https://api.modavis.org/hdp/v1/update-available-components \[POST\])
- Updated HDP Components Schema to Version 0.1.0-alpha.2
- Updated UI to correctly render the new HDP Components Schema Version 0.1.0-alpha.2
- Initiated `./server_app/utils/component_utils.py` with the intention to collect tools for upcoming component development, evaluation and synchronization purposes.
- Essential fix for component environment generation, dependency installation and correct environment calling — including bundled application handling

### Minor:
- Fixed missing directories bug that prevented startup
- Fixed Progress Bar in Component Installation Modal
- Added detection of name–structure mismatches of Pipeline Components

# [**Version 0.1.0-alpha.1 (2025-08-15)**](https://github.com/Digital-Humanities-Jena/heritage-data-processor/releases/tag/v0.1.0-alpha.1)

- Initial release of the first alpha version.