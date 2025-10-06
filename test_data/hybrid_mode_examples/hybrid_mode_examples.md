# Test Data: Hybrid Mode

## Purpose
This test dataset demonstrates Hybrid mode, which combines Root and Subdirectory modes. Root-level files are processed individually (with optional bundling), while subdirectories become their own records.

## Processing Mode Configuration
- **Batch Entity**: hybrid
- **Bundle Congruent Patterns**: Yes (checked) - applies only to root-level files
- **Bundling Strategy**: stem
- **Primary Source Extension**: .obj

## File Extensions to Select
- [x] .obj
- [x] .mtl
- [x] .jpg
- [x] .png
- [x] .glb
- [x] .fbx
- [x] .txt

## OBJ File Options
- Add MTL Files: Yes (checked)
- Add Texture Files: Yes (checked)
- Texture Search Directories: [Input Data Directory] (default)

## Expected Behavior
When scanned with Hybrid mode:
- 3 separate Zenodo records will be created
- Root-level files are bundled using stem strategy (standalone_artifact_001)
- Each subdirectory becomes its own record

### Record 1 (standalone_artifact_001) - Root-level bundle:
- standalone_artifact_001.obj (source)
- standalone_artifact_001.mtl (primary)
- standalone_reference_photo.png (secondary)

### Record 2 (excavation_batch_alpha) - Subdirectory:
Contains all files from the excavation_batch_alpha/ folder:
- fragment_001.obj (source)
- fragment_002.obj (source)
- fragment_003.obj (source)
- shared_textures/clay_texture.jpg (secondary)
- shared_textures/weathering_normal.jpg (secondary)

### Record 3 (excavation_batch_beta) - Subdirectory:
Contains all files from the excavation_batch_beta/ folder:
- complete_vessel.glb (source)
- vessel_fragments.fbx (source)
- documentation.txt (secondary)

## File Count
- Total files: 12
- Root-level files: 3
- Subdirectory files: 9
- Primary sources: 6
- Dependencies: 6

## Use Case
This mode is ideal when:
- Some files are standalone and should be processed individually
- Other files are organized into folders that represent complete records
- A dataset has mixed organizational patterns
- Flexibility is needed to handle both individual files and grouped collections
