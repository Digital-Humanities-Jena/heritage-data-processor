# Test Data: FBX with Material Textures

## Purpose
This demonstrates how FBX files are scanned for external texture dependencies in common folder locations (Materials/, textures/, etc.).

## Processing Mode Configuration
- **Batch Entity**: root
- **Bundle Congruent Patterns**: Yes (checked)
- **Bundling Strategy**: stem
- **Primary Source Extension**: .fbx

## File Extensions to Select
- [x] .fbx
- [x] .png
- [x] .jpg

## OBJ File Options
- Add Texture Files: Yes (checked)
- Texture Search Directories: [Input Data Directory] (default)

## Expected Behavior
When scanned:
- 1 Zenodo record will be created (temple_reconstruction)
- The scanner looks for textures in common FBX folder patterns
- All textures in the Materials/ subfolder are automatically included
- FBX may have embedded or external textures

### Bundle (temple_reconstruction):
- temple_reconstruction.fbx (source)
- Materials/texture.jpeg (secondary)

## File Count
- Total files: 2
- Primary sources: 1 (.fbx)
- Secondary dependencies: 1 (textures in Materials/ folder)

## Technical Details
The scanner searches for textures in:
1. Common folder names: "Materials/", "Textures/", "textures/"
2. Same-name folder as the FBX file (e.g., temple_reconstruction/)
3. Additional search directories if specified
4. Texture extensions: .png, .jpg, .jpeg, .tga, .tif, .tiff, .bmp, .dds

Note: FBX files may have embedded textures that are not visible as separate files.
