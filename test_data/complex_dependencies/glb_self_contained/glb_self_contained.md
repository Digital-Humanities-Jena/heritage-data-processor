# Test Data: GLB Self-Contained Format

## Purpose
This demonstrates how GLB (Binary glTF) files are handled as self-contained assets with embedded textures and materials, requiring no external dependencies.

## Processing Mode Configuration
- **Batch Entity**: root
- **Bundle Congruent Patterns**: Yes (checked)
- **Bundling Strategy**: stem
- **Primary Source Extension**: .glb

## File Extensions to Select
- [x] .glb
- [x] .jpg

## OBJ File Options
- Not applicable (GLB files don't use OBJ options)

## Expected Behavior
When scanned:
- 1 Zenodo record will be created (bronze_helmet)
- The GLB file contains all materials and textures internally
- No external file scanning or dependency resolution occurs
- The reference photo is bundled by stem matching

### Bundle (bronze_helmet):
- bronze_helmet.glb (source) - self-contained 3D model
- reference_photo.jpg (secondary) - bundled by stem match

## File Count
- Total files: 2
- Primary sources: 1 (.glb)
- Dependencies: 1 (.jpg)

## Technical Details
GLB format characteristics:
- All textures are embedded in the binary file
- All materials are included in the file structure
- No external file parsing or scanning is performed
- The format is ideal for archival and distribution
- The file can be opened in any glTF viewer without additional files
