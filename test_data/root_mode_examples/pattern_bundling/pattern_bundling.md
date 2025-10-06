# Test Data: Root Mode - Pattern Bundling

## Purpose
This test dataset demonstrates how the Pattern bundling strategy groups files that match a specific pattern or contain a common identifier extracted via regex.

## Processing Mode Configuration
- **Batch Entity**: root
- **Bundle Congruent Patterns**: Yes (checked)
- **Bundling Strategy**: pattern
- **Bundling Pattern**: `model_\d+`
- **Primary Source Extension**: .obj

## File Extensions to Select
- [x] .obj
- [x] .mtl
- [x] .png

## OBJ File Options
- Add MTL Files: Yes (checked)
- Add Texture Files: Yes (checked)
- Texture Search Directories: [Input Data Directory] (default)

## Expected Behavior
When scanned with Root mode and pattern bundling:
- 2 separate Zenodo records will be created (model_001 and model_002)
- Files are grouped by the pattern "model_001" and "model_002" extracted from filenames
- Each bundle includes:
  - Primary source: .obj file
  - Primary dependency: .mtl file
  - Secondary dependencies: texture .png files

### Bundle 1 (model_001):
- model_001_sculpture.obj (source)
- model_001_sculpture.mtl (primary)
- model_001_sculpture.jpg (secondary)

### Bundle 2 (model_002):
- model_002_sculpture.obj (source)
- model_002_sculpture.mtl (primary)
- model_002_sculpture.jpg (secondary)

## File Count
- Total files: 8
- Primary sources: 2 (.obj files)
- Dependencies: 6 (2 .mtl + 4 .png)

## Use Case
This mode is ideal when:
- Files follow a consistent naming convention with identifiers
- Multiple files belong to the same logical group (e.g., model_001_*)
- Regex patterns can extract the grouping key
