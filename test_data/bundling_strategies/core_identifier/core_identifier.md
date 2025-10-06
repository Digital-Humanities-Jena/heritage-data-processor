# Test Data: Core Identifier Bundling Strategy

## Purpose
This demonstrates extracting a core pattern (like a site number) that may appear with various prefixes and suffixes in filenames.

## Processing Mode Configuration
- **Batch Entity**: root
- **Bundle Congruent Patterns**: Yes (checked)
- **Bundling Strategy**: coreidentifier
- **Core Pattern**: `site\d+` (extracts site numbers like site042, site093)
- **Primary Source Extension**: .obj

## File Extensions to Select
- [x] .obj
- [x] .fbx
- [x] .glb

## OBJ File Options
- Add MTL Files: No (unchecked)
- Add Texture Files: No (unchecked)

## Expected Behavior
When scanned:
- 2 Zenodo records will be created (site042 and site093)
- The core pattern "site042" or "site093" is extracted from various filename formats
- Files with the same site number are grouped regardless of surrounding text

### Bundle 1 (site042):
- site042_structure_main.fbx (source)
- site042_structure_detail.obj (source)

### Bundle 2 (site093):
- site093_artifact_complete.glb (source)
- site093_artifact_fragment.obj (source)

## File Count
- Total files: 4
- Primary sources: 4 (mixed formats)
- Dependencies: 0

## Pattern Explanation
- Core Pattern: `site\d+`
- `site` - Literal "site" text
- `\d+` - One or more digits
- Result: Extracts "site042" from "site042_structure_main.fbx"
- Matches anywhere in the filename, regardless of surrounding text

## Alternative Core Patterns to Try
- `ID\d{6}` - Extracts 6-digit IDs (ID000123)
- `specimen_[A-Z]+` - Extracts specimen codes (specimen_ABC)
- `\d{4}-\d{2}` - Extracts date patterns (2024-03)

## Use Case
Core identifier strategy is ideal when:
- A specific identifier appears consistently across related files
- The identifier may be embedded in different filename structures
- Surrounding text varies but the core ID remains the same
