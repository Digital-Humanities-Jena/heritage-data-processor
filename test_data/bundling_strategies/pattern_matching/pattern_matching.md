# Test Data: Pattern Matching Bundling Strategy

## Purpose
This demonstrates advanced regex pattern matching to extract location-based identifiers from complex filenames.

## Processing Mode Configuration
- **Batch Entity**: root
- **Bundle Congruent Patterns**: Yes (checked)
- **Bundling Strategy**: pattern
- **Bundling Pattern**: `^([A-Za-z]+)_` (extracts location prefix before underscore)
- **Primary Source Extension**: .obj

## File Extensions to Select
- [x] .obj
- [x] .mtl

## OBJ File Options
- Add MTL Files: Yes (checked)
- Add Texture Files: No (unchecked)

## Expected Behavior
When scanned:
- 2 Zenodo records will be created (Athens and Rome)
- The regex pattern captures the location name before the first underscore
- Multiple sections from the same location are grouped together

### Bundle 1 (Athens):
- Athens_Temple_Section_A.obj (source)
- Athens_Temple_Section_B.obj (source)
- Athens_Temple_materials.mtl (primary)

### Bundle 2 (Rome):
- Rome_Forum_Column_01.obj (source)
- Rome_Forum_Column_02.obj (source)
- Rome_Forum_materials.mtl (primary)

## File Count
- Total files: 6
- Primary sources: 4 (.obj files)
- Dependencies: 2 (.mtl files)

## Pattern Explanation
- Pattern: `^([A-Za-z]+)_`
- `^` - Start of filename
- `([A-Za-z]+)` - Capture group: one or more letters
- `_` - Literal underscore character
- Result: Extracts "Athens" from "Athens_Temple_Section_A.obj"

## Alternative Patterns to Try
- `model_(\d+)` - Extracts numeric IDs (model_001 → "001")
- `([A-Z]+)_` - Extracts uppercase prefixes only
- `site(\d+)` - Extracts site numbers (site042 → "042")
