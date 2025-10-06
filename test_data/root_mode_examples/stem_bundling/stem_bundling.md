# Test Data: Root Mode - Stem Bundling (Default)

## Purpose
This test dataset demonstrates the default Stem bundling strategy, which groups files based on their filename stem (filename without extension).

## Processing Mode Configuration
- **Batch Entity**: root
- **Bundle Congruent Patterns**: Yes (checked)
- **Bundling Strategy**: stem (default)
- **Primary Source Extension**: .obj

## File Extensions to Select
- [x] .obj
- [x] .mtl
- [x] .png
- [x] .glb
- [x] .fbx

## OBJ File Options
- Add MTL Files: Yes (checked)
- Add Texture Files: Yes (checked)
- Texture Search Directories: [Input Data Directory] (default)

## Expected Behavior
When scanned with Root mode and stem bundling:
- 3 separate Zenodo records will be created
- Files with the same stem (e.g., "temple_column") are grouped together
- Self-contained formats (.glb, .fbx) become individual records

### Bundle 1 (temple_column):
- temple_column.obj (source)
- temple_column.mtl (primary)
- temple_column.jpg (secondary)

### Bundle 2 (ancient_tablet):
- ancient_tablet.glb (source) - self-contained

### Bundle 3 (ceramic_bowl):
- ceramic_bowl.fbx (source)

## File Count
- Total files: 5
- Primary sources: 3 (.obj, .glb, .fbx)
- Dependencies: 2 (1 .mtl + 1 .jpg)

## Use Case
This is the simplest and most common bundling mode, ideal when:
- Files share the exact same base name with different extensions
- OBJ models are accompanied by MTL and texture files with matching names
- File naming follows standard conventions (model.obj, model.mtl, model_texture.png)
