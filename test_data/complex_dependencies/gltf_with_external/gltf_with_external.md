# Test Data: GLTF with External Dependencies

## Purpose
This demonstrates how GLTF (Text glTF) files are parsed to detect external binary buffers and texture image references.

## Processing Mode Configuration
- **Batch Entity**: root
- **Bundle Congruent Patterns**: Yes (checked)
- **Bundling Strategy**: stem
- **Primary Source Extension**: .gltf

## File Extensions to Select
- [x] .gltf
- [x] .bin
- [x] .png
- [x] .jpg

## OBJ File Options
- Add Texture Files: Yes (checked)
- Texture Search Directories: [Input Data Directory] (default)

## Expected Behavior
When scanned:
- 1 Zenodo record will be created (ancient_sword)
- The GLTF JSON file is parsed to find external references
- Binary buffer files (.bin) are detected as primary dependencies
- Image files referenced in the GLTF are detected as secondary dependencies

### Bundle (ancient_sword):
- ancient_sword.gltf (source) - text-based 3D model description
- ancient_sword.bin (primary) - binary geometry/animation data
- blade_texture.jpeg (secondary) - referenced in GLTF

## File Count
- Total files: 3
- Primary sources: 1 (.gltf)
- Primary dependencies: 1 (.bin)
- Secondary dependencies: 1 (textures)

## Technical Details
The scanner will:
1. Parse the GLTF JSON file structure
2. Extract "buffers" array to find .bin references
3. Extract "images" array to find texture references
4. Resolve paths relative to the GLTF file location
5. Categorize .bin as primary and images as secondary dependencies
