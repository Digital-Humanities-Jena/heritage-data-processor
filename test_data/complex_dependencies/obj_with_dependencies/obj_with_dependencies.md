# Test Data: Complex OBJ Dependencies

## Purpose
This demonstrates comprehensive OBJ file dependency scanning with MTL material files and multiple texture types (diffuse, normal, roughness, bump).

## Processing Mode Configuration
- **Batch Entity**: root
- **Bundle Congruent Patterns**: Yes (checked)
- **Bundling Strategy**: stem
- **Primary Source Extension**: .obj

## File Extensions to Select
- [x] .obj
- [x] .mtl
- [x] .png
- [x] .jpg

## OBJ File Options
- Add MTL Files: Yes (checked)
- Add Texture Files: Yes (checked)
- Texture Search Directories: [Input Data Directory] (default)

## Expected Behavior
When scanned:
- 1 Zenodo record will be created (roman_statue)
- The MTL file is automatically detected by parsing the OBJ
- All texture files referenced in the MTL are automatically found and included
- The application demonstrates smart texture resolution across multiple formats

### Bundle (roman_statue):
- roman_statue.obj (source)
- roman_statue.mtl (primary) - detected from OBJ file
- marble_diffuse.jpg (secondary) - referenced in MTL
- marble_normal.jpg (secondary) - referenced in MTL
- marble_roughness.jpg (secondary) - referenced in MTL
- detail_bump.jpg (secondary) - referenced in MTL

## File Count
- Total files: 6
- Primary sources: 1 (.obj)
- Primary dependencies: 1 (.mtl)
- Secondary dependencies: 4 (textures)

## Technical Details
The scanner will:
1. Parse the OBJ file for "mtllib" directives
2. Locate the MTL file relative to the OBJ
3. Parse the MTL file for texture map directives (map_Kd, map_Bump, map_Ns, etc.)
4. Resolve texture paths relative to the MTL location
5. Search additional directories if specified
