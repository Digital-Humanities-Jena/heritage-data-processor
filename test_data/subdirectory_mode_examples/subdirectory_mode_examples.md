# Test Data: Subdirectory Mode

## Purpose
This test dataset demonstrates how Subdirectory mode treats each immediate subfolder as a separate Zenodo record, collecting all files within that subfolder into a single record.

## Processing Mode Configuration
- **Batch Entity**: subdirectory
- **Bundling Enabled**: Not applicable (subdirectories define the grouping)
- **Primary Source Extension**: .obj

## File Extensions to Select
- [x] .obj
- [x] .mtl
- [x] .glb
- [x] .jpg
- [x] .png
- [x] .pdf

## OBJ File Options
- Add MTL Files: Yes (checked)
- Add Texture Files: Yes (checked)
- Texture Search Directories: [Input Data Directory] (default)

## Expected Behavior
When scanned with Subdirectory mode:
- 3 separate Zenodo records will be created (one per subfolder)
- All files within each subfolder are included in that record
- Files in nested subdirectories (e.g., textures/, reference_images/) are included
- Root-level files (readme.txt) are ignored

### Record 1 (archaeological_site_001):
Contains 3 root files + 3 files from textures/ subfolder:
- site_overview.obj (source)
- site_overview.mtl (primary)
- excavation_photo_001.png (secondary)
- excavation_photo_002.png (secondary)
- textures/stone_texture.jpg (secondary)
- textures/roof.jpg (secondary)
- textures/wood_normal.jpg (secondary)

### Record 2 (archaeological_site_002):
Contains 3 files:
- artifact_scan.glb (source)
- context_photo.png (secondary)
- documentation.pdf (secondary)

### Record 3 (museum_collection_item_045):
Contains 2 root files + 3 files from reference_images/ subfolder:
- main_model.fbx (source)
- detail_scan_001.obj (source)
- detail_scan_001.mtl (primary)
- reference_images/front_view.jpg (secondary)
- reference_images/side_view.jpg (secondary)
- reference_images/top_view.jpg (secondary)

## File Count
- Total directories: 3
- Total files: 15
- Primary sources: 4 (.obj, .glb, .fbx)
- Dependencies: 11

## Use Case
This mode is ideal when:
- Research data is already organized into logical folders
- Each folder represents a distinct collection, site, or specimen
- Multiple related files of various types belong to the same record
- Folder structure reflects the desired record structure
