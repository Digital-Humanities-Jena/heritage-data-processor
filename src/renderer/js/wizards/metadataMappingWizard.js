// src/renderer/js/wizards/metadataMappingWizard.js

import { PYTHON_API_BASE_URL, fetchAndDisplayAllDataFromBackend } from '../core/api.js';
import { currentlyLoadedHdpcPath, currentProjectId, appDataCache, zenodoMappingSchema } from '../core/state.js';
import { showToast, loader } from '../core/ui.js';
import { addToLog } from '../renderer.js';

// --- DOM Elements ---
// Configure/Reconfigure Modal
const configureMappingBtn = document.getElementById('configureMappingBtn');
const reconfigureMappingBtn = document.getElementById('reconfigureMappingBtn');
const metadataMappingModal = document.getElementById('metadataMappingModal');
const closeMetadataMappingModalBtn = document.getElementById('closeMetadataMappingModalBtn');
const metadataMappingModalBody = document.getElementById('metadataMappingModalBody');
const metadataMappingModalTitle = document.getElementById('metadataMappingModalTitle');
const mappingStep1_FileSelection = document.getElementById('mappingStep1_FileSelection');
const metadataFileTypeSelect = document.getElementById('metadataFileType');
const metadataFilePathDisplay = document.getElementById('metadataFilePathDisplay');
const browseMetadataFileBtn = document.getElementById('browseMetadataFileBtn');
const metadataFilePreviewArea = document.getElementById('metadataFilePreviewArea');
const metadataFileColumnsEl = document.getElementById('metadataFileColumns');
const metadataFileDataPreviewEl = document.getElementById('metadataFileDataPreview');
const metadataFilenameColumnSelect = document.getElementById('metadataFilenameColumn');
const mappingStep2_FieldMapping = document.getElementById('mappingStep2_FieldMapping');
const metadataMappingStatus = document.getElementById('metadataMappingStatus');
const metadataMappingBackBtn = document.getElementById('metadataMappingBackBtn');
const metadataMappingNextBtn = document.getElementById('metadataMappingNextBtn');
const metadataMappingSaveBtn = document.getElementById('metadataMappingSaveBtn');

// View Mapping Modal
const viewMappingBtn = document.getElementById('viewMappingBtn');
const viewMappingModal = document.getElementById('viewMappingModal');
const closeViewMappingModalBtn = document.getElementById('closeViewMappingModalBtn');
const closeViewMappingModalFooterBtn = document.getElementById('closeViewMappingModalFooterBtn');
const viewMappingModalTitle = document.getElementById('viewMappingModalTitle');
const viewMappingModalBody = document.getElementById('viewMappingModalBody');

// --- Module State ---
let currentMappingStep = 1;
let mappingData = {}; // Will be reset on open
let complexFieldInstanceCounter = 0;

// --- Wizard Logic ---

function resetMetadataMappingWizard() {
    currentMappingStep = 0;
    mappingData = {
        hdpcPath: currentlyLoadedHdpcPath || '',
        projectId: currentProjectId ?? null,
        mappingMode: null,
        metadataFilePath: '',
        metadataFileFormat: 'csv',
        columns: [],
        previewData: [],
        filenameColumn: '',
        fieldMappings: {}
    };
    if (metadataFileTypeSelect) metadataFileTypeSelect.value = 'csv';
    if (metadataFilePathDisplay) metadataFilePathDisplay.value = '';
    if (metadataFilePreviewArea) metadataFilePreviewArea.classList.add('hidden');
    const dynamicForm = document.getElementById('dynamicMappingFormContainer');
    if (dynamicForm) dynamicForm.innerHTML = '';
    if (metadataMappingStatus) metadataMappingStatus.textContent = '';
}

export async function openMetadataMappingModal(isReconfigure = false) {
    if (!currentlyLoadedHdpcPath || currentProjectId === null) {
        showToast("Please load a project first.", "error");
        return;
    }
    resetMetadataMappingWizard(); 
    metadataMappingModal?.classList.remove('hidden');

    // Automatically determine the mode when reconfiguring
    const existingMapping = appDataCache.mappings?.[0]?.column_definitions 
        ? JSON.parse(appDataCache.mappings[0].column_definitions) 
        : null;

    // If a file path exists in a saved config, set the mode to 'file' from the start.
    if (existingMapping?._file_path) {
        mappingData.mappingMode = 'file';
    }

    // Always render the full interface which includes file selection.
    // The UI will be in a "generic" state until a file is chosen, at which point
    // the handleBrowseAndLoadFile function will explicitly set the mode.
    renderFullMappingInterface('file');
}

async function browseForMetadataFile() {
    const filePath = await window.electronAPI.openFile({
        properties: ['openFile'],
        filters: [{ name: 'Spreadsheet Files', extensions: ['csv', 'xlsx', 'xls'] }]
    });
    if (filePath && metadataFilePathDisplay) {
        metadataFilePathDisplay.value = filePath;
        mappingData.metadataFilePath = filePath;
        if (filePath.endsWith('.csv')) metadataFileTypeSelect.value = 'csv';
        else if (filePath.endsWith('.xlsx') || filePath.endsWith('.xls')) metadataFileTypeSelect.value = 'excel';
    }
}

async function handleMetadataMappingNext() {
    if (metadataMappingStatus) metadataMappingStatus.textContent = '';
    if (metadataMappingNextBtn) metadataMappingNextBtn.disabled = true;

    if (currentMappingStep === 1) {
        // Step 1 -> 2: Load the selected spreadsheet file and get a preview.
        mappingData.metadataFileFormat = metadataFileTypeSelect.value;
        if (!mappingData.metadataFilePath) {
            if (metadataMappingStatus) metadataMappingStatus.textContent = "Please select a metadata file.";
            if (metadataMappingNextBtn) metadataMappingNextBtn.disabled = false;
            return;
        }

        if (loader) loader.style.display = 'block';
        try {
            const response = await fetch(`${PYTHON_API_BASE_URL}/api/project/metadata/load_file_preview`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filePath: mappingData.metadataFilePath,
                    fileFormat: mappingData.metadataFileFormat
                })
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || `Failed to load metadata file preview (status: ${response.status})`);
            }
            
            mappingData.columns = result.columns || [];
            mappingData.previewData = result.previewData || [];

            if (metadataFileColumnsEl) metadataFileColumnsEl.textContent = mappingData.columns.join(' | ');
            if (metadataFileDataPreviewEl) {
                let tableHtml = '<table class="w-full text-left border-collapse"><thead><tr class="bg-gray-100">';
                (mappingData.columns || []).forEach(col => tableHtml += `<th class="border p-1 text-xs">${col}</th>`);
                tableHtml += '</tr></thead><tbody>';
                (mappingData.previewData || []).forEach(row => {
                    tableHtml += '<tr>';
                    (mappingData.columns || []).forEach(col => {
                        const cellValue = row[col] !== undefined && row[col] !== null ? String(row[col]) : '';
                        tableHtml += `<td class="border p-1 text-xs">${cellValue.length > 50 ? cellValue.substring(0, 50) + '...' : cellValue}</td>`;
                    });
                    tableHtml += '</tr>';
                });
                tableHtml += '</tbody></table>';
                metadataFileDataPreviewEl.innerHTML = tableHtml;
            }
            if (metadataFilenameColumnSelect) {
                metadataFilenameColumnSelect.innerHTML = '<option value="">- Select Filename Column -</option>' +
                    (mappingData.columns || []).map(col => `<option value="${col}">${col}</option>`).join('');
            }
            if (metadataFilePreviewArea) metadataFilePreviewArea.classList.remove('hidden');
            currentMappingStep = 2;
        } catch (error) {
            console.error("Error loading metadata file preview:", error);
            if (metadataMappingStatus) metadataMappingStatus.textContent = `Error: ${error.message}`;
            showToast(`Error loading preview: ${error.message}`, "error");
        } finally {
            if (loader) loader.style.display = 'none';
        }

    } else if (currentMappingStep === 2) {
        // Step 2 -> 3: Confirm the filename column and proceed to the main mapping form.
        mappingData.filenameColumn = metadataFilenameColumnSelect.value;
        if (!mappingData.filenameColumn) {
            if (metadataMappingStatus) metadataMappingStatus.textContent = "Please select the column that contains filenames.";
            if (metadataMappingNextBtn) metadataMappingNextBtn.disabled = false;
            return;
        }
        addToLog("Metadata Mapping", `Filename column: ${mappingData.filenameColumn}. Proceeding to field mapping.`);
        currentMappingStep = 3;
    }

    updateMetadataMappingWizardView(); // TODO

    // Re-enable 'Next' button if it's still relevant for the new view (which it is for step 2)
    if (metadataMappingNextBtn && !metadataMappingNextBtn.classList.contains('hidden')) {
        metadataMappingNextBtn.disabled = false;
    }
}

function handleMetadataMappingBack() {
    if (currentMappingStep > 0) {
        currentMappingStep--;
        updateMetadataMappingWizardView(); // TODO
    }
}

async function handleSaveMetadataMapping() {
    console.log(" MAPPING SAVE: Starting the save process.");
    addToLog("Metadata Mapping Save", "Starting the save process.");

    if (!mappingData.hdpcPath || mappingData.projectId === null) {
        showToast("Project context is missing. Cannot save mapping.", "error");
        addToLog("Metadata Mapping Save", "Error: Project context missing.");
        return;
    }

    const finalMappings = {
        _mapping_mode: mappingData.mappingMode
    };

    if (mappingData.mappingMode === 'file') {
        const filenameCol = document.getElementById('pipelineFilenameColumn')?.value;
        if (!filenameCol) {
            showToast("Filename column linkage is not selected. Cannot save mapping.", "error");
            addToLog("Metadata Mapping Save", "Error: Filename linkage column not selected.");
            return;
        }
        finalMappings._file_path = mappingData.metadataFilePath;
        finalMappings._file_format = mappingData.metadataFileFormat;
        finalMappings.filename = { type: 'column', value: filenameCol };
    }

    const formContainer = document.getElementById('dynamicMappingFormContainer');
    let allValidationsPass = true;

    // --- Gather Standard Fields ---
    formContainer.querySelectorAll('.mapping-field-item[data-field-key]').forEach(fieldWrapper => {
        if (!allValidationsPass) return;
        const fieldKey = fieldWrapper.dataset.fieldKey;
        if (fieldKey === 'filename' || fieldWrapper.classList.contains('complex-field-item')) return;

        const fieldSchema = window.zenodoMappingSchema?.standard_fields.find(f => f.key === fieldKey);
        const typeRadio = fieldWrapper.querySelector(`input[name="maptype_${fieldKey}"]:checked`);
        if (!typeRadio) return;

        const mappingType = typeRadio.value;
        const controlsDiv = fieldWrapper.querySelector('.mapping-input-controls');
        if (!controlsDiv) return;

        // Logic for different mapping types...
        if (mappingType === 'filename') {
            const filenameOptRadio = controlsDiv.querySelector(`input[name="${fieldKey}_filename_opt"]:checked`);
            const subtype = filenameOptRadio ? filenameOptRadio.value : 'complete';
            let constructedValue = null;
            if (subtype === 'constructed') {
                const input = controlsDiv.querySelector(`input[name="${fieldKey}_constructed_value"]`);
                if (input && input.value.trim()) {
                    constructedValue = input.value.trim();
                }
            }
            finalMappings[fieldKey] = { type: 'filename', subtype: subtype, value: constructedValue };
        } else if (mappingType === 'column' && mappingData.mappingMode === 'file') {
            if (fieldSchema && fieldSchema.allow_multiple_columns) {
                const orderedColumns = Array.from(controlsDiv.querySelectorAll('.ordered-column-pill')).map(p => p.dataset.columnName);
                if (orderedColumns.length > 0) {
                    finalMappings[fieldKey] = {
                        type: orderedColumns.length > 1 ? 'ordered_combined_columns' : 'column',
                        value: orderedColumns.length > 1 ? orderedColumns : orderedColumns[0],
                        delimiter: controlsDiv.querySelector(`input[name="${fieldKey}_delimiter"]`)?.value || ' ',
                        hierarchical_delimiter: controlsDiv.querySelector(`input[name="${fieldKey}_hierarchical_delimiter"]`)?.value || null
                    };
                }
            } else {
                const select = controlsDiv.querySelector(`select[name="${fieldKey}_select_column_value"]`);
                if (select?.value) finalMappings[fieldKey] = { type: 'column', value: select.value };
            }
        } else if (mappingType === 'literal' || mappingType === 'vocab') {
            const input = controlsDiv.querySelector(`input[name*="_literal_value"], select[name*="_vocab_value"]`);
            if (input?.value.trim()) {
                 if (fieldSchema && fieldSchema.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(input.value.trim())) {
                    showToast(`Invalid date format for ${fieldSchema.label}. Please use YYYY-MM-DD.`, "error");
                    input.classList.add('border-red-500');
                    allValidationsPass = false;
                    return;
                }
                input.classList.remove('border-red-500');
                finalMappings[fieldKey] = { type: 'literal', value: input.value.trim() };
            }
        } else if (mappingType === 'construct_later') {
            finalMappings[fieldKey] = { type: 'construct_later', value: true };
        }
    });

    if (!allValidationsPass) {
        addToLog("Metadata Mapping Save", "Validation failed for one or more standard fields.");
        return;
    }

    // --- Gather Complex Fields ---
    formContainer.querySelectorAll('.complex-field-item').forEach(complexFieldWrapper => {
        if (!allValidationsPass) return;
        const fieldKey = complexFieldWrapper.dataset.fieldKey;
        const entries = [];
        const fieldConfig = window.zenodoMappingSchema.complex_fields[fieldKey];

        complexFieldWrapper.querySelectorAll('.complex-entry').forEach(entryDiv => {
            if (!allValidationsPass) return;
            const currentEntryMap = {};
            let entryHasData = false;

            fieldConfig.attributes.forEach(attrSchema => {
                const subFieldDiv = entryDiv.querySelector(`.sub-field-item[data-attrkey="${attrSchema.key}"]`);
                if (!subFieldDiv) return;

                const typeRadioSub = subFieldDiv.querySelector('.mapping-type-radios-sub input:checked');
                const controlsAreaSub = subFieldDiv.querySelector('.mapping-input-area-sub');
                if (!typeRadioSub || !controlsAreaSub) return;

                const subMappingType = typeRadioSub.value;
                const inputElement = controlsAreaSub.querySelector('input, select');

                if (inputElement && inputElement.value.trim()) {
                    entryHasData = true;
                    let value = inputElement.value.trim();
                    if (subMappingType === 'literal' && attrSchema.validation_regex) {
                        const regex = new RegExp(attrSchema.validation_regex);
                        if (!regex.test(value)) {
                            showToast(`Invalid format for ${fieldConfig.label} -> ${attrSchema.label}.`, "error");
                            inputElement.classList.add('border-red-500');
                            allValidationsPass = false;
                            return;
                        }
                        inputElement.classList.remove('border-red-500');
                    }
                    currentEntryMap[attrSchema.key] = { type: subMappingType, value: value };
                }
            });
            if (entryHasData) entries.push(currentEntryMap);
        });
        
        if (entries.length > 0) {
            finalMappings[fieldKey] = { type: 'complex', is_complex: true, entries: entries };
        }
    });

    if (!allValidationsPass) {
        addToLog("Metadata Mapping Save", "Validation failed for one or more complex fields.");
        return;
    }
    
    // --- Log Final Payload ---
    console.log(" MAPPING SAVE: Final configuration object to be saved:", finalMappings);
    addToLog("Metadata Mapping Save", `Final configuration object being sent to backend:\n${JSON.stringify(finalMappings, null, 2)}`);

    mappingData.fieldMappings = finalMappings;

    if (loader) loader.style.display = 'block';
    try {
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/project/metadata/save_mapping`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                hdpcPath: mappingData.hdpcPath,
                projectId: mappingData.projectId,
                mappingConfiguration: mappingData.fieldMappings,
            })
        });
        const result = await response.json();
        if (!result.success) throw new Error(result.error || "Failed to save metadata mapping.");
        
        showToast("Metadata mapping saved successfully!", "success");
        addToLog("Metadata Mapping Save", "Successfully saved mapping to backend.");
        if (metadataMappingModal) metadataMappingModal.classList.add('hidden');
        await fetchAndDisplayAllDataFromBackend();
    } catch (error) {
        console.error("Error saving metadata mapping:", error);
        if (metadataMappingStatus) metadataMappingStatus.textContent = `Error: ${error.message}`;
        showToast(`Error saving mapping: ${error.message}`, "error");
        addToLog("Metadata Mapping Save", `Error during save: ${error.message}`);
    } finally {
        if (loader) loader.style.display = 'none';
    }
}

// --- UI Rendering for Mapping Form ---

async function initializeFieldMappingUI(formContainer, schema, fileColumns, existingFieldMappings = null) {
    if (!formContainer) {
        console.error("CRITICAL UI ERROR: initializeFieldMappingUI - formContainer missing.");
        return;
    }

    if (loader) loader.style.display = 'block';
    formContainer.innerHTML = '<p class="text-gray-500 p-4">Loading Zenodo metadata schema...</p>';

    let currentZenodoSchema = schema || window.zenodoMappingSchema;
    try {
        if (!currentZenodoSchema) {
            const response = await fetch(`${PYTHON_API_BASE_URL}/api/metadata/mapping_schema_details`);
            if (!response.ok) {
                let errText = "Failed to fetch mapping schema";
                try { const d = await response.json(); errText = d.error || errText; } catch(e){}
                throw new Error(errText);
            }
            currentZenodoSchema = await response.json();
            window.zenodoMappingSchema = currentZenodoSchema;
        }
        if (!currentZenodoSchema?.standard_fields || !currentZenodoSchema?.complex_fields || !currentZenodoSchema?.vocabularies) {
            throw new Error("Mapping schema is invalid or incomplete.");
        }
        formContainer.innerHTML = '';

        let finalMappingsToUse = {};
        if (existingFieldMappings && typeof existingFieldMappings === 'object') {
            finalMappingsToUse = existingFieldMappings;
        } else {
            const mappingEntry = (appDataCache?.mappings || []).find(m => m.column_definitions);
            if (mappingEntry?.column_definitions) {
                try {
                    const parsed = JSON.parse(mappingEntry.column_definitions);
                    if (typeof parsed === 'object' && parsed !== null) {
                        finalMappingsToUse = parsed;
                        mappingData.fieldMappings = parsed;
                    }
                } catch (e) { console.error("Could not parse existing mapping for pre-fill:", e); }
            }
        }

        const standardFieldsSection = document.createElement('div');
        standardFieldsSection.className = 'settings-section mb-6';
        standardFieldsSection.innerHTML = `<h4 class="text-lg font-semibold text-gray-800 mb-3 pb-2 border-b">Standard Zenodo Fields</h4>`;
        
        const isFileMode = fileColumns && fileColumns.length > 0;

        currentZenodoSchema.standard_fields.forEach(fieldSchema => {
            const fieldWrapper = document.createElement('div');
            fieldWrapper.className = 'py-3 border-b border-gray-200 mapping-field-item';
            fieldWrapper.dataset.fieldKey = fieldSchema.key;

            const fieldHeaderDiv = document.createElement('div');
            fieldHeaderDiv.className = 'md:flex md:items-start md:space-x-4';
            
            const fieldLabelEl = document.createElement('div');
            fieldLabelEl.className = 'md:w-1/3';
            fieldLabelEl.innerHTML = `<label class="block text-sm font-medium text-gray-700">${fieldSchema.label} ${fieldSchema.mandatory ? '<span class="text-red-500">*</span>' : ''}</label>
                                     ${fieldSchema.notes ? `<p class="text-xs text-gray-500">${fieldSchema.notes}</p>` : ''}`;
            fieldHeaderDiv.appendChild(fieldLabelEl);

            const inputAreaWrapper = document.createElement('div');
            inputAreaWrapper.className = 'mt-1 md:mt-0 md:w-2/3 space-y-2 mapping-input-area-wrapper';
            fieldHeaderDiv.appendChild(inputAreaWrapper);
            fieldWrapper.appendChild(fieldHeaderDiv);
            
            let currentMappingForField = finalMappingsToUse[fieldSchema.key];

            if (!currentMappingForField && fieldSchema.default) {
                let useThisDefault = fieldSchema.default;
                let defaultType = fieldSchema.type === 'vocab' ? 'vocab' : 'literal';
                if (fieldSchema.key === 'upload_type' && appDataCache?.projectInfo[0]?.modality === "Image / Photography") {
                    useThisDefault = 'image'; defaultType = 'vocab';
                } else if (fieldSchema.key === 'publication_date' && fieldSchema.default === 'current_date') {
                    useThisDefault = new Date().toISOString().split('T')[0]; defaultType = 'literal';
                } else if (fieldSchema.key === 'access_right') {
                    useThisDefault = fieldSchema.default || 'open'; defaultType = 'vocab';
                }
                currentMappingForField = { type: defaultType, value: useThisDefault };
            }
            if (!currentMappingForField) {
                currentMappingForField = {};
            }

            renderStandardFieldInputControls(fieldSchema.key, fieldSchema, fileColumns, currentZenodoSchema.vocabularies, currentMappingForField, inputAreaWrapper, isFileMode);
            standardFieldsSection.appendChild(fieldWrapper);
        });
        formContainer.appendChild(standardFieldsSection);

        // --- Render Complex Fields ---
        complexFieldInstanceCounter = 0; // Reset counter for unique radio names
        const complexFieldsSection = document.createElement('div');
        complexFieldsSection.className = 'settings-section mb-6';
        complexFieldsSection.innerHTML = `<h4 class="text-lg font-semibold text-gray-800 mt-6 mb-3 pt-4 border-t">Complex & Repeated Fields</h4>`;
        
        Object.entries(currentZenodoSchema.complex_fields || {}).forEach(([fieldKey, fieldConfig]) => {
            const complexFieldWrapper = document.createElement('div');
            complexFieldWrapper.className = 'py-3 border-t border-gray-200 mapping-field-item complex-field-item';
            complexFieldWrapper.dataset.fieldKey = fieldKey;

            const headerDiv = document.createElement('div');
            headerDiv.className = 'flex justify-between items-center mb-2';
            headerDiv.innerHTML = `<div>
                                     <label class="block text-sm font-medium text-gray-700">${fieldConfig.label} ${fieldConfig.mandatory ? '<span class="text-red-500">*</span>' : ''}</label>
                                     ${fieldConfig.notes ? `<p class="text-xs text-gray-500">${fieldConfig.notes}</p>` : ''}
                                   </div>`;
            if (fieldConfig.allow_multiple) {
                const addBtn = document.createElement('button');
                addBtn.type = 'button';
                addBtn.className = 'add-complex-entry-btn text-xs bg-green-500 hover:bg-green-600 text-white py-1 px-2 rounded';
                addBtn.textContent = `+ Add ${fieldConfig.item_label || 'Entry'}`;
                addBtn.dataset.fieldkey = fieldKey;
                addBtn.addEventListener('click', handleAddComplexEntryClick);
                headerDiv.appendChild(addBtn);
            }
            complexFieldWrapper.appendChild(headerDiv);

            const entriesContainer = document.createElement('div');
            entriesContainer.className = 'complex-entries-container mt-2 space-y-3';
            complexFieldWrapper.appendChild(entriesContainer);
            complexFieldsSection.appendChild(complexFieldWrapper);

            const existingEntriesForField = (finalMappingsToUse[fieldKey]?.type === 'complex' && Array.isArray(finalMappingsToUse[fieldKey]?.entries))
                ? finalMappingsToUse[fieldKey].entries
                : [];

            if (existingEntriesForField.length > 0) {
                existingEntriesForField.forEach(entryData => {
                    addComplexFieldEntry(fieldKey, fieldConfig, entriesContainer, currentZenodoSchema.vocabularies, entryData);
                });
            } else if (fieldConfig.mandatory && !fieldConfig.allow_multiple) {
                 // If the field is mandatory but not multiple, add one empty entry block by default
                 addComplexFieldEntry(fieldKey, fieldConfig, entriesContainer, currentZenodoSchema.vocabularies, {});
            }
        });

        if (Object.keys(currentZenodoSchema.complex_fields || {}).length > 0) {
           formContainer.appendChild(complexFieldsSection);
        }
        
        checkConditionalFieldsVisibility();

    } catch (error) {
        console.error("[initializeFieldMappingUI] Error:", error);
        formContainer.innerHTML = `<p class="text-red-500 p-4 font-bold">Error loading mapping form: ${error.message}.</p>`;
    } finally {
        if (loader) loader.style.display = 'none';
    }
}

function checkConditionalFieldsVisibility() {
    if (!window.zenodoMappingSchema || !window.zenodoMappingSchema.standard_fields) {
        console.warn("Zenodo mapping schema not available for conditional visibility check.");
        return;
    }
    const formContainer = document.getElementById('dynamicMappingFormContainer');
    if (!formContainer) {
         console.warn("Form container not found for conditional visibility check.");
        return;
    }

    const currentSelections = {};

    function getSelectedValueForField(fieldKey) {
        const fieldWrapper = formContainer.querySelector(`.mapping-field-item[data-field-key="${fieldKey}"]`);
        if (!fieldWrapper) return undefined;
        const typeRadio = fieldWrapper.querySelector(`.mapping-type-radios input[name="maptype_${fieldKey}"]:checked`);
        if (!typeRadio) return undefined;

        const mappingType = typeRadio.value;
        const inputAreaWrapper = fieldWrapper.querySelector('.mapping-input-area-wrapper'); // Parent of controlsDiv
        if (!inputAreaWrapper) return undefined;
        const controlsDiv = inputAreaWrapper.querySelector('.mapping-input-controls'); // Actual inputs container
        if(!controlsDiv) return undefined;


        if (mappingType === 'vocab') {
            const select = controlsDiv.querySelector(`select[name="${fieldKey}_vocab_value"]`);
            return select ? select.value : undefined;
        } else if (mappingType === 'literal') {
            const input = controlsDiv.querySelector(`input[name="${fieldKey}_literal_value"]`);
            return input ? input.value : undefined;
        }
        return undefined; 
    }

    currentSelections['upload_type'] = getSelectedValueForField('upload_type');
    currentSelections['access_right'] = getSelectedValueForField('access_right');

    window.zenodoMappingSchema.standard_fields.forEach(fieldSchema => {
        const fieldWrapper = formContainer.querySelector(`.mapping-field-item[data-field-key="${fieldSchema.key}"]`);
        if (!fieldWrapper) return;

        let isVisible = true;
        if (fieldSchema.mandatory_rule) {
            const [dependentFieldKey, requiredValuesStr] = fieldSchema.mandatory_rule.split(':');
            const requiredValues = requiredValuesStr.split(',');
            const actualDependentValue = currentSelections[dependentFieldKey];
            
            isVisible = requiredValues.includes(actualDependentValue);
        }

        fieldWrapper.classList.toggle('hidden', !isVisible);

        if (isVisible) {
            const inputAreaWrapper = fieldWrapper.querySelector('.mapping-input-area-wrapper');
            if (!inputAreaWrapper) return;

            const existingTypeRadio = fieldWrapper.querySelector(`.mapping-type-radios input[name="maptype_${fieldSchema.key}"]:checked`);
             // Try to get existing specific mapping, fallback to empty if complex or not found
            let currentFullMapping = mappingData.fieldMappings[fieldSchema.key] || {};
            if (typeof currentFullMapping.value === 'object' && !Array.isArray(currentFullMapping.value)) { // Avoid passing complex objects as value for simple fields
                currentFullMapping = { type: currentFullMapping.type, value: '', delimiter: currentFullMapping.delimiter, hierarchical_delimiter: currentFullMapping.hierarchical_delimiter};
            }


            // Problem 1: "Publication Type" only if "Upload Type" is "Publication (publication)".
            // Problem 4: "Embargo End Date" only if "Access Rights" is "Embargoed Access (embargoed)".
            // Problem 3 (Image Type Default) & Problem 8 (License Default) are handled here when fields become visible.
            if (fieldSchema.key === 'publication_type' && currentSelections['upload_type'] === 'publication') {
                if ((!existingTypeRadio || existingTypeRadio.value !== 'vocab') && fieldSchema.type === 'vocab' && window.zenodoMappingSchema.vocabularies[fieldSchema.vocabKey]) {
                   renderStandardFieldInputControls(fieldSchema.key, fieldSchema, mappingData.columns, window.zenodoMappingSchema.vocabularies, { type: 'vocab', value: currentFullMapping.value || fieldSchema.default || '' }, inputAreaWrapper);
                }
            } else if (fieldSchema.key === 'image_type' && currentSelections['upload_type'] === 'image') {
                if ((!existingTypeRadio || existingTypeRadio.value !== 'vocab') && fieldSchema.type === 'vocab' && window.zenodoMappingSchema.vocabularies[fieldSchema.vocabKey]) {
                    renderStandardFieldInputControls(fieldSchema.key, fieldSchema, mappingData.columns, window.zenodoMappingSchema.vocabularies, { type: 'vocab', value: currentFullMapping.value || fieldSchema.default || 'photo' }, inputAreaWrapper);
                }
            } else if (fieldSchema.key === 'license' && (currentSelections['access_right'] === 'open' || currentSelections['access_right'] === 'embargoed')) {
                 if ((!existingTypeRadio || existingTypeRadio.value !== 'vocab') && fieldSchema.type === 'vocab' && window.zenodoMappingSchema.vocabularies[fieldSchema.vocabKey]) {
                    renderStandardFieldInputControls(fieldSchema.key, fieldSchema, mappingData.columns, window.zenodoMappingSchema.vocabularies, { type: 'vocab', value: currentFullMapping.value || fieldSchema.default || 'cc-by-4.0' }, inputAreaWrapper);
                 }
            }
            // No specific re-render needed for embargo_date, its visibility is enough.
        }
    });
}


function renderStandardFieldInputControls(fieldKey, fieldSchema, fileColumns, vocabularies, currentMappingValue, inputAreaWrapper) {
    inputAreaWrapper.innerHTML = '';
    const isFileMode = fileColumns && fileColumns.length > 0;

    let defaultMappingType = isFileMode ? 'column' : 'literal';
    if (fieldSchema.type === 'vocab') defaultMappingType = 'vocab';
    if (fieldSchema.allow_construct_later && fieldSchema.key === 'description') defaultMappingType = 'construct_later';

    let selectedMappingType = currentMappingValue?.type || defaultMappingType;
    if (fieldSchema.type === 'vocab' && currentMappingValue?.type === 'literal' && vocabularies[fieldSchema.vocabKey]?.[currentMappingValue?.value]) {
        selectedMappingType = 'vocab';
    }

    const typeRadiosDiv = document.createElement('div');
    typeRadiosDiv.className = 'flex flex-wrap gap-x-4 gap-y-2 text-xs mb-2 mapping-type-radios';
    typeRadiosDiv.dataset.fieldkey = fieldKey;

    const availableTypes = [];
    // Important: Only add "Map Column" if in file mode
    if (isFileMode) {
        availableTypes.push({ value: 'column', label: fieldSchema.allow_multiple_columns ? 'Map Column(s)' : 'Map Column' });
    }
    availableTypes.push({ value: 'filename', label: 'From Filename' });
    availableTypes.push({ value: 'literal', label: 'Set Literal Value' });
    if (fieldSchema.type === 'vocab' && vocabularies[fieldSchema.vocabKey]) {
        availableTypes.push({ value: 'vocab', label: 'Select from List' });
    }
    if (fieldSchema.allow_construct_later) {
        availableTypes.push({ value: 'construct_later', label: 'Construct Automatically' });
    }

    availableTypes.forEach(typeOpt => {
        const label = document.createElement('label');
        label.className = 'inline-flex items-center cursor-pointer';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `maptype_${fieldKey}`;
        radio.value = typeOpt.value;
        radio.className = 'form-radio h-3 w-3 text-blue-600 mapping-type-selector';
        radio.checked = selectedMappingType === typeOpt.value;
        radio.addEventListener('change', (e) => {
            renderStandardFieldInputControls(fieldKey, fieldSchema, fileColumns, vocabularies, { type: e.target.value }, inputAreaWrapper);
            checkConditionalFieldsVisibility();
        });
        label.appendChild(radio);
        label.append(` ${typeOpt.label}`);
        typeRadiosDiv.appendChild(label);
    });
    inputAreaWrapper.appendChild(typeRadiosDiv);

    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'mapping-input-controls space-y-2 mt-2';
    inputAreaWrapper.appendChild(controlsDiv);

    let prefillValue = currentMappingValue?.value;
    let prefillSubtype = currentMappingValue?.subtype || 'complete';
    let prefillDelimiter = currentMappingValue?.delimiter;
    let prefillHierDelimiter = currentMappingValue?.hierarchical_delimiter;
    
    if (selectedMappingType === 'filename') {
        const subOptionsContainer = document.createElement('div');
        subOptionsContainer.className = 'p-2 border rounded-md bg-gray-50';
        const filenameOptionsHtml = `
            <div class="flex items-center space-x-4">
                <label class="text-sm"><input type="radio" name="${fieldKey}_filename_opt" value="complete" ${prefillSubtype === 'complete' ? 'checked' : ''}> Complete</label>
                <label class="text-sm"><input type="radio" name="${fieldKey}_filename_opt" value="stem" ${prefillSubtype === 'stem' ? 'checked' : ''}> No Extension</label>
                <label class="text-sm"><input type="radio" name="${fieldKey}_filename_opt" value="constructed" ${prefillSubtype === 'constructed' ? 'checked' : ''}> Constructed</label>
            </div>
            <div id="${fieldKey}_filename_constructed_div" class="${prefillSubtype === 'constructed' ? '' : 'hidden'} mt-2">
                <input type="text" class="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm text-sm" name="${fieldKey}_constructed_value" 
                       placeholder="e.g., Image-{part1}-{part2}" value="${prefillSubtype === 'constructed' ? (prefillValue || '') : ''}">
                <p class="text-xs text-gray-500 mt-1">Define parts using placeholders like <code>{part1}</code>, <code>{part2}</code>.</p>
            </div>
        `;
        subOptionsContainer.innerHTML = filenameOptionsHtml;
        controlsDiv.appendChild(subOptionsContainer);
        subOptionsContainer.querySelectorAll(`input[name="${fieldKey}_filename_opt"]`).forEach(radio => {
            radio.addEventListener('change', (e) => {
                document.getElementById(`${fieldKey}_filename_constructed_div`).classList.toggle('hidden', e.target.value !== 'constructed');
            });
        });
    } else if (selectedMappingType === 'column' && isFileMode) {
        if (fieldSchema.allow_multiple_columns) {
            let selectedColumns = Array.isArray(prefillValue) ? [...prefillValue] : (prefillValue ? [prefillValue] : []);
            const multiColumnContainer = document.createElement('div');
            multiColumnContainer.className = 'border p-2 rounded-md bg-gray-50 space-y-1';
            const selectedColumnsDiv = document.createElement('div');
            selectedColumnsDiv.innerHTML = '<p class="text-xs font-medium text-gray-600 mb-1">Selected Columns (in order):</p>';
            const selectedPillsContainer = document.createElement('div');
            selectedPillsContainer.id = `${fieldKey}_selected_columns_display`;
            selectedPillsContainer.className = 'flex flex-wrap gap-1 p-1 border border-gray-300 rounded min-h-[30px] bg-white';
            const availableColumnsDiv = document.createElement('div');
            availableColumnsDiv.className = 'mt-2';
            availableColumnsDiv.innerHTML = '<p class="text-xs font-medium text-gray-600 mb-1">Available Columns:</p>';
            const availableColumnsList = document.createElement('div');
            availableColumnsList.className = 'flex flex-wrap gap-1 max-h-20 overflow-y-auto p-1';
            const updatePillsDisplay = () => {
                selectedPillsContainer.innerHTML = '';
                if (selectedColumns.length === 0) {
                    selectedPillsContainer.innerHTML = '<span class="text-xs text-gray-400 italic p-1">Click columns below to add</span>';
                    return;
                }
                selectedColumns.forEach((colName, index) => {
                    const pill = document.createElement('span');
                    pill.className = 'bg-blue-500 text-white text-xs px-2 py-1 rounded-full flex items-center ordered-column-pill';
                    pill.dataset.columnName = colName;
                    pill.innerHTML = `<span>${index + 1}. ${colName}</span>`;
                    const removeBtn = document.createElement('button');
                    removeBtn.type = 'button';
                    removeBtn.innerHTML = '&times;';
                    removeBtn.className = 'ml-1.5 text-blue-200 hover:text-white focus:outline-none';
                    removeBtn.onclick = () => {
                        selectedColumns.splice(index, 1);
                        updatePillsDisplay();
                        updateAvailableButtons();
                    };
                    pill.appendChild(removeBtn);
                    selectedPillsContainer.appendChild(pill);
                });
            };
            const updateAvailableButtons = () => {
                availableColumnsList.querySelectorAll('button').forEach(btn => {
                    btn.disabled = selectedColumns.includes(btn.dataset.columnName);
                    btn.classList.toggle('opacity-40', btn.disabled);
                });
            };
            fileColumns.forEach(col => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.textContent = col;
                btn.className = 'bg-gray-200 hover:bg-blue-200 text-gray-700 text-xs px-2 py-1 rounded m-0.5 transition-opacity';
                btn.dataset.columnName = col;
                btn.addEventListener('click', () => {
                    if (!selectedColumns.includes(col)) {
                        selectedColumns.push(col);
                        updatePillsDisplay();
                        updateAvailableButtons();
                    }
                });
                availableColumnsList.appendChild(btn);
            });
            selectedColumnsDiv.appendChild(selectedPillsContainer);
            availableColumnsDiv.appendChild(availableColumnsList);
            multiColumnContainer.appendChild(selectedColumnsDiv);
            multiColumnContainer.appendChild(availableColumnsDiv);
            controlsDiv.appendChild(multiColumnContainer);
            updatePillsDisplay();
            updateAvailableButtons();
            const delimiterInput = document.createElement('input');
            delimiterInput.type = 'text';
            delimiterInput.placeholder = 'Delimiter (e.g., " - ")';
            delimiterInput.name = `${fieldKey}_delimiter`;
            delimiterInput.className = 'mt-2 block w-full md:w-1/2 p-2 border border-gray-300 rounded-md shadow-sm text-sm';
            delimiterInput.value = prefillDelimiter || (fieldKey === 'keywords' ? ', ' : ' - ');
            controlsDiv.appendChild(delimiterInput);
            if (fieldKey === 'keywords' && fieldSchema.allow_hierarchical_delimiter) {
                const hierDelimiterInput = document.createElement('input');
                hierDelimiterInput.type = 'text';
                hierDelimiterInput.placeholder = 'Hierarchical Delimiter (e.g., " > ")';
                hierDelimiterInput.name = `${fieldKey}_hierarchical_delimiter`;
                hierDelimiterInput.className = 'mt-1 block w-full md:w-1/2 p-2 border border-gray-300 rounded-md shadow-sm text-sm';
                hierDelimiterInput.value = prefillHierDelimiter || '';
                controlsDiv.appendChild(hierDelimiterInput);
            }
        } else {
            const select = document.createElement('select');
            select.className = 'mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm bg-white text-sm';
            select.name = `${fieldKey}_select_column_value`;
            select.innerHTML = '<option value="">- Select Column -</option>' + fileColumns.map(col => `<option value="${col}" ${prefillValue === col ? 'selected' : ''}>${col}</option>`).join('');
            controlsDiv.appendChild(select);
        }
    } else if (selectedMappingType === 'literal') {
        const input = document.createElement('input');
        input.type = fieldSchema.type === 'date' ? 'date' : 'text';
        input.className = 'mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm text-sm';
        input.name = `${fieldKey}_literal_value`;
        input.value = (typeof prefillValue === 'string' || typeof prefillValue === 'number') ? prefillValue : '';
        if (fieldSchema.type === 'date') {
            input.placeholder = "YYYY-MM-DD";
            if (!input.value && fieldSchema.default === 'current_date') {
                input.value = new Date().toISOString().split('T')[0];
            }
        }
        controlsDiv.appendChild(input);
    } else if (selectedMappingType === 'vocab') {
        const select = document.createElement('select');
        select.className = 'mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm bg-white text-sm';
        select.name = `${fieldKey}_vocab_value`;
        select.innerHTML = '<option value="">- Select Value -</option>' + Object.entries(vocabularies[fieldSchema.vocabKey] || {}).map(([k, v]) => `<option value="${k}" ${prefillValue === k ? 'selected' : ''}>${v} (${k})</option>`).join('');
        if (fieldSchema.default && (!prefillValue || !(prefillValue in (vocabularies[fieldSchema.vocabKey] || {})))) {
            select.value = fieldSchema.default;
        }
        controlsDiv.appendChild(select);
    } else if (selectedMappingType === 'construct_later') {
        controlsDiv.innerHTML = '<p class="text-sm text-green-600 p-2 bg-green-50 rounded">This field will be constructed automatically by the backend.</p>';
    }
}

function renderComplexFieldAttributeControls(fieldKey, attrSchema, fileColumns, vocabularies, currentAttributeValue, entryIndex, instanceIndex) {
    const subFieldDiv = document.createElement('div');
    subFieldDiv.className = 'mb-2 sub-field-item border-l-2 border-gray-200 pl-2';
    subFieldDiv.dataset.attrkey = attrSchema.key;

    const label = document.createElement('label');
    label.className = 'block text-xs font-medium text-gray-600';
    label.innerHTML = `${attrSchema.label} ${attrSchema.mandatory ? '<span class="text-red-500">*</span>' : ''}`;
    if (attrSchema.notes) label.title = attrSchema.notes;
    subFieldDiv.appendChild(label);

    const typeRadiosDiv = document.createElement('div');
    typeRadiosDiv.className = 'flex space-x-2 text-xs mapping-type-radios-sub mt-1';

    // Check mappingData.mappingMode directly to determine if we are in file mode.
    const isFileMode = mappingData.mappingMode === 'file' && fileColumns && fileColumns.length > 0;

    let defaultType = isFileMode ? 'column' : 'literal';
    if (attrSchema.type === 'vocab' && vocabularies && vocabularies[attrSchema.vocabKey]) {
        defaultType = 'vocab';
    }
    let currentSelectedType = currentAttributeValue?.type || defaultType;
    if (attrSchema.type === 'vocab' && currentAttributeValue?.type === 'literal' && vocabularies?.[attrSchema.vocabKey]?.[currentAttributeValue?.value]) {
        currentSelectedType = 'vocab';
    }

    const attributeMappingTypes = [];
    // This condition is now correct and will work as intended.
    if (isFileMode) {
        attributeMappingTypes.push({ value: 'column', label: 'Column' });
    }
    attributeMappingTypes.push({ value: 'literal', label: 'Literal' });
    if (attrSchema.type === 'vocab' && vocabularies && vocabularies[attrSchema.vocabKey]) {
        attributeMappingTypes.push({ value: 'vocab', label: 'Select from List' });
    }

    attributeMappingTypes.forEach(typeOpt => {
        const radioLabel = document.createElement('label');
        radioLabel.className = 'inline-flex items-center cursor-pointer';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `maptype_${fieldKey}_${instanceIndex}_${attrSchema.key}`;
        radio.value = typeOpt.value;
        radio.className = 'form-radio h-3 w-3 text-blue-500 mapping-type-selector-sub';
        radio.checked = currentSelectedType === typeOpt.value;
        radio.addEventListener('change', (e) => {
            const newType = e.target.value;
            const controlsArea = subFieldDiv.querySelector('.mapping-input-area-sub');
            renderSubFieldInputControls(attrSchema, fileColumns, vocabularies, newType, currentAttributeValue, controlsArea, `mapvalue_${fieldKey}_${instanceIndex}_${attrSchema.key}`);
        });
        radioLabel.appendChild(radio);
        radioLabel.append(` ${typeOpt.label}`);
        typeRadiosDiv.appendChild(radioLabel);
    });
    subFieldDiv.appendChild(typeRadiosDiv);

    const inputAreaSub = document.createElement('div');
    inputAreaSub.className = 'mapping-input-area-sub mt-1';
    subFieldDiv.appendChild(inputAreaSub);

    renderSubFieldInputControls(attrSchema, fileColumns, vocabularies, currentSelectedType, currentAttributeValue, inputAreaSub, `mapvalue_${fieldKey}_${instanceIndex}_${attrSchema.key}`);

    return subFieldDiv;
}

function renderSubFieldInputControls(attrSchema, fileColumns, vocabularies, selectedType, currentAttributeValue, inputArea, baseName) {
    inputArea.innerHTML = ''; // Clear
    let prefillValue = currentAttributeValue?.value || '';

    if (selectedType === 'column') {
        const select = document.createElement('select');
        select.className = 'mt-1 block w-full p-1.5 text-xs border border-gray-300 rounded-md shadow-sm bg-white';
        select.name = `${baseName}_select_column_value`;
        select.dataset.mapTarget = attrSchema.key;
        select.innerHTML = '<option value="">- Select Column -</option>' +
            (fileColumns || []).map(col => `<option value="${col}" ${prefillValue === col ? 'selected' : ''}>${col}</option>`).join('');
        inputArea.appendChild(select);
    } else if (selectedType === 'literal') {
        const input = document.createElement('input');
        input.type = attrSchema.type === 'date' ? 'date' : 'text';
        input.className = 'mt-1 block w-full p-1.5 text-xs border border-gray-300 rounded-md shadow-sm';
        input.name = `${baseName}_literal_value`;
        input.dataset.mapTarget = attrSchema.key;
        input.value = (typeof prefillValue === 'string' || typeof prefillValue === 'number') ? prefillValue : '';
        if (attrSchema.type === 'date') input.placeholder = "YYYY-MM-DD";
        inputArea.appendChild(input);

        if (attrSchema.validation_regex) { // For ORCID/GND
            const validationMessageSpan = document.createElement('span');
            validationMessageSpan.className = 'text-xs ml-2 validation-message';
            input.addEventListener('input', () => {
                const regex = new RegExp(attrSchema.validation_regex);
                const isValid = !input.value || regex.test(input.value);
                validationMessageSpan.textContent = isValid ? (input.value ? 'Valid' : '') : (attrSchema.validation_message || 'Invalid format.');
                validationMessageSpan.className = `text-xs ml-2 validation-message ${isValid ? (input.value ? 'text-green-500' : '') : 'text-red-500'}`;
            });
            if (input.value) input.dispatchEvent(new Event('input'));
            inputArea.appendChild(validationMessageSpan);
        }
    } else if (selectedType === 'vocab' && attrSchema.type === 'vocab' && vocabularies && vocabularies[attrSchema.vocabKey]) {
        const select = document.createElement('select');
        select.className = 'mt-1 block w-full p-1.5 text-xs border border-gray-300 rounded-md shadow-sm bg-white';
        select.name = `${baseName}_vocab_value`;
        select.dataset.mapTarget = attrSchema.key;
        
        let optionsHTML = '<option value="">- Select Value -</option>';
        Object.entries(vocabularies[attrSchema.vocabKey]).forEach(([key, value]) => {
            const isSelected = prefillValue === key ? 'selected' : '';
            optionsHTML += `<option value="${key}" ${isSelected}>${value} (${key})</option>`; 
        });
        select.innerHTML = optionsHTML;

        inputArea.appendChild(select);
    }
}

function addComplexFieldEntry(fieldKey, fieldConfig, container, vocabularies, entryData = {}) {
    const entryDiv = document.createElement('div');
    entryDiv.className = 'p-3 border rounded-md bg-gray-50 complex-entry relative mb-3';
    // instanceIndex helps create unique names for radio buttons within each entry
    const instanceIndex = complexFieldInstanceCounter++; 

    (fieldConfig.attributes || []).forEach(attrSchema => {
        const currentAttributeValue = entryData ? entryData[attrSchema.key] : undefined;
        entryDiv.appendChild(renderComplexFieldAttributeControls(fieldKey, attrSchema, mappingData.columns, vocabularies, currentAttributeValue, Array.from(container.children).length, instanceIndex));
    });

    if (fieldConfig.allow_multiple) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-complex-entry-btn absolute top-1 right-1 text-red-500 hover:text-red-700 text-xs p-1';
        removeBtn.innerHTML = '&times;';
        removeBtn.title = `Remove this ${fieldConfig.item_label || 'entry'}`;
        removeBtn.addEventListener('click', (e) => {
            e.target.closest('.complex-entry').remove();
            // Optional: if removing an entry should affect other conditional UI, call:
            // checkConditionalFieldsVisibility();
        });
        entryDiv.appendChild(removeBtn);
    }
    container.appendChild(entryDiv);
    // checkConditionalFieldsVisibility();
}

export function handleAddComplexEntryClick(e) {
    const fieldKey = e.target.dataset.fieldkey;

    // Add a guard clause to ensure zenodoMappingSchema and complex_fields are loaded
    if (!window.zenodoMappingSchema || !window.zenodoMappingSchema.complex_fields) {
        showToast("Error: The metadata schema is not loaded. Please try reloading or ensure the project is correctly configured.", "error");
        console.error("handleAddComplexEntryClick: zenodoMappingSchema or zenodoMappingSchema.complex_fields is not available.");
        return;
    }

    const fieldConfig = window.zenodoMappingSchema.complex_fields[fieldKey]; 

    if (!fieldConfig) {
        showToast(`Error: Configuration for complex field '${fieldKey}' not found in schema.`, "error");
        console.error(`handleAddComplexEntryClick: No fieldConfig found for key '${fieldKey}' in zenodoMappingSchema.complex_fields.`);
        return;
    }
    
    const container = e.target.closest('.complex-field-item').querySelector('.complex-entries-container');
    
    // Ensure vocabularies are also available from the schema to pass down
    if (!window.zenodoMappingSchema.vocabularies) {
        showToast("Error: Vocabularies are missing from the metadata schema.", "error");
        console.error("handleAddComplexEntryClick: zenodoMappingSchema.vocabularies is missing.");
        return;
    }

    addComplexFieldEntry(fieldKey, fieldConfig, container, window.zenodoMappingSchema.vocabularies, {}); // Pass vocabularies
}

// --- View Mapping Modal Logic ---

async function openViewMappingModal() { // Make the function async
    console.log("[ViewMappingModal] Opening. Checking appDataCache.mappings...");
    if (!appDataCache.mappings || appDataCache.mappings.length === 0) {
        showToast("No mapping configured to view.", "info");
        console.log("[ViewMappingModal] No mappings found in appDataCache.");
        return;
    }
    const mapping = appDataCache.mappings[0]; // Assuming first is active
    console.log("[ViewMappingModal] Active mapping entry from cache:", mapping);

    if (!mapping.column_definitions) {
        showToast("Mapping data is incomplete (missing column_definitions).", "error");
        console.error("[ViewMappingModal] Mapping data incomplete, column_definitions missing.");
        if(viewMappingModalBody) viewMappingModalBody.innerHTML = '<p class="text-red-500">Error: Mapping definitions are missing.</p>';
        if (viewMappingModal) viewMappingModal.classList.remove('hidden');
        return;
    }

    // --- Ensure zenodoMappingSchema is loaded ---
    if (!window.zenodoMappingSchema || !window.zenodoMappingSchema.standard_fields) {
        console.log("[ViewMappingModal] zenodoMappingSchema not found or incomplete, attempting to fetch...");
        try {
            const response = await fetch(`${PYTHON_API_BASE_URL}/api/metadata/mapping_schema_details`);
            if (!response.ok) {
                let errorMsg = "Failed to fetch mapping schema for viewing.";
                try { const errData = await response.json(); errorMsg = errData.error || errorMsg; } catch(e) { /* ignore */ }
                throw new Error(errorMsg);
            }
            window.zenodoMappingSchema = await response.json();
            if (!window.zenodoMappingSchema || !window.zenodoMappingSchema.standard_fields) {
                throw new Error("Fetched mapping schema is invalid or empty.");
            }
            console.log("[ViewMappingModal] zenodoMappingSchema fetched successfully.");
        } catch (schemaError) {
            console.error("[ViewMappingModal] Error fetching zenodoMappingSchema:", schemaError);
            showToast(`Could not load metadata schema: ${schemaError.message}`, "error");
            // Fallback: display raw, as the schema is essential for proper labels
            // The existing fallback logic in the try...catch below will handle this
        }
    } else {
        console.log("[ViewMappingModal] zenodoMappingSchema already loaded.");
    }

    try {
        const definitions = JSON.parse(mapping.column_definitions);
        console.log("[ViewMappingModal] Parsed mapping definitions:", definitions);

        if(viewMappingModalTitle) viewMappingModalTitle.textContent = `Viewing Mapping: ${mapping.mapping_name || 'Default'}`;
        
        let html = `<div class="space-y-4 text-sm">`;

        const sourceFilePath = definitions._file_path || 'N/A';
        const sourceFileFormat = definitions._file_format || 'N/A';
        html += `<p><strong>Source File:</strong> <code class="text-xs bg-gray-100 p-0.5 rounded">${sourceFilePath}</code> (${sourceFileFormat})</p>`;

        const filenameColumnValue = definitions.filename?.value || 'N/A';
        html += `<p><strong>Filename Column (links to project files):</strong> <code class="text-xs bg-gray-100 p-0.5 rounded">${filenameColumnValue}</code></p>`;
        
        html += `<hr class="my-3">`;
        html += `<h4 class="font-semibold text-md mb-2">Field Mappings:</h4>`;
        
        const actualFieldMappings = Object.keys(definitions).filter(key => !key.startsWith('_') && key !== 'filename');

        if (actualFieldMappings.length === 0) {
            html += '<p class="text-gray-500 italic">No specific Zenodo fields have been mapped in this configuration beyond filename linkage.</p>';
        } else {
            html += `<ul class="list-none space-y-2 pl-1">`;

            // Display Standard Fields
            if (window.zenodoMappingSchema && window.zenodoMappingSchema.standard_fields) {
                console.log("[ViewMappingModal] Rendering standard fields using schema.");
                window.zenodoMappingSchema.standard_fields.forEach(fieldSchema => {
                    const key = fieldSchema.key;
                    if (key === 'filename' || key.startsWith('_')) return; 

                    const mappedValue = definitions[key];
                    const fieldLabel = fieldSchema.label || key.charAt(0).toUpperCase() + key.slice(1);

                    html += `<li class="py-1 border-b border-gray-100 last:border-b-0"><strong>${fieldLabel}:</strong> `;
                    if (mappedValue) {
                        html += formatMappingValueForDisplay(mappedValue);
                    } else {
                        html += `<span class="text-gray-400 italic">Not Mapped</span>`;
                    }
                    html += `</li>`;
                });
            } else {
                html += '<li><p class="text-orange-500 italic font-semibold">Standard field schema not available. Displaying raw mapped keys:</p><ul class="list-disc list-inside pl-4 mt-1 text-xs">';
                actualFieldMappings.forEach(key => {
                    if (!window.zenodoMappingSchema?.complex_fields?.[key] && definitions[key] && typeof definitions[key] === 'object' && definitions[key].type !== 'complex') {
                        html += `<li><strong>${key}:</strong> ${formatMappingValueForDisplay(definitions[key])}</li>`;
                    } else if (!window.zenodoMappingSchema?.complex_fields?.[key] && definitions[key] && typeof definitions[key] !== 'object') { // Simple literal not in schema
                         html += `<li><strong>${key}:</strong> <code class="text-xs bg-gray-100 p-0.5 rounded">${definitions[key]}</code> (Raw value)</li>`;
                    }
                });
                html += '</ul></li>';
            }

            // Display Complex Fields
            if (window.zenodoMappingSchema && window.zenodoMappingSchema.complex_fields) {
                console.log("[ViewMappingModal] Rendering complex fields using schema.");
                Object.entries(window.zenodoMappingSchema.complex_fields).forEach(([complexKey, complexConfig]) => {
                    const mappedValue = definitions[complexKey];
                    const fieldDisplayName = complexConfig.label || complexKey.charAt(0).toUpperCase() + complexKey.slice(1);

                    html += `<li class="py-1 border-b border-gray-100 last:border-b-0"><strong>${fieldDisplayName}:</strong> `;
                    if (mappedValue && mappedValue.type === 'complex' && mappedValue.entries && mappedValue.entries.length > 0) {
                        const entryLabel = complexConfig.item_label || 'Entry';
                        const entryLabelPlural = mappedValue.entries.length === 1 ? entryLabel : (complexConfig.item_label_plural || `${entryLabel}s`);
                        
                        html += `(${mappedValue.entries.length} ${entryLabelPlural})<ul class="mt-1 space-y-1 text-xs">`;
                        
                        mappedValue.entries.forEach((entry, index) => {
                            html += `<li class="ml-4 border-l-2 border-gray-200 pl-2 py-1 bg-gray-50 rounded-r-md"><em>${entryLabel} ${index + 1}:</em><ul class="list-none list-inside ml-2 space-y-0.5">`;
                            (complexConfig.attributes || []).forEach(attrSchema => {
                                const attrLabel = attrSchema.label || attrSchema.key.charAt(0).toUpperCase() + attrSchema.key.slice(1);
                                html += `<li><strong>${attrLabel}:</strong> `;
                                if (entry[attrSchema.key]) {
                                    html += formatMappingValueForDisplay(entry[attrSchema.key]);
                                } else {
                                    html += `<span class="text-gray-400 italic">Not Mapped</span>`;
                                }
                                html += `</li>`;
                            });
                            html += `</ul></li>`;
                        });
                        html += `</ul>`;
                    } else if (mappedValue) { 
                        html += formatMappingValueForDisplay(mappedValue); // Handles cases where it might be mapped as non-complex or complex with no entries
                    } else { 
                        html += `<span class="text-gray-400 italic">Not Mapped</span>`;
                    }
                    html += `</li>`;
                });
            } else {
                 html += '<li><p class="text-orange-500 italic font-semibold mt-2">Complex field schema not available. Displaying raw mapped complex keys:</p><ul class="list-disc list-inside pl-4 mt-1 text-xs">';
                 actualFieldMappings.forEach(key => {
                    if (definitions[key] && definitions[key].type === 'complex') { // Check if it looks like a complex field definition
                        html += `<li><strong>${key}:</strong> ${formatMappingValueForDisplay(definitions[key])} (Entries: ${definitions[key].entries?.length || 0})</li>`;
                    }
                });
                html += '</ul></li>';
            }
            html += `</ul>`;
        }
        html += `</div>`;

        if(viewMappingModalBody) viewMappingModalBody.innerHTML = html;
        if (viewMappingModal) viewMappingModal.classList.remove('hidden');

    } catch (e) {
        console.error("[ViewMappingModal] Error rendering mapping view:", e);
        if(viewMappingModalBody) viewMappingModalBody.innerHTML = '<p class="text-red-500">Could not display mapping. Data might be corrupted.</p>';
        if (viewMappingModal) viewMappingModal.classList.remove('hidden');
    }
}

function formatMappingValueForDisplay(mappedItem) {
    if (!mappedItem || typeof mappedItem.type === 'undefined') return '<span class="text-gray-400 italic">Not Mapped</span>';
    switch (mappedItem.type) {
        case 'column':
            return `Mapped from column: <code class="text-xs bg-gray-100 p-0.5 rounded">${mappedItem.value || 'N/A'}</code>`;
        case 'literal':
            return `Literal value: <code class="text-xs bg-gray-100 p-0.5 rounded">${mappedItem.value || 'N/A'}</code>`;
        case 'combined_columns':
        case 'ordered_combined_columns':
            const cols = Array.isArray(mappedItem.value) ? mappedItem.value.join(', ') : (mappedItem.value || 'N/A');
            return `Combined from columns: <code class="text-xs bg-gray-100 p-0.5 rounded">${cols}</code> with delimiter "<code>${mappedItem.delimiter || '(space)'}</code>"`;
        case 'construct_later':
            return '<span class="text-green-600">Constructed Automatically</span>';
        default:
            return `<span class="text-orange-500">Unknown mapping type: ${mappedItem.type}</span> (Value: ${mappedItem.value || 'N/A'})`;
    }
}

// --- Initialization ---
export function initMetadataMapping() {
    if (configureMappingBtn) configureMappingBtn.addEventListener('click', () => openMetadataMappingModal(false));
    if (reconfigureMappingBtn) reconfigureMappingBtn.addEventListener('click', () => openMetadataMappingModal(true));
    if (closeMetadataMappingModalBtn) closeMetadataMappingModalBtn.addEventListener('click', () => metadataMappingModal.classList.add('hidden'));
    if (browseMetadataFileBtn) browseMetadataFileBtn.addEventListener('click', browseForMetadataFile);
    if (metadataMappingNextBtn) metadataMappingNextBtn.addEventListener('click', handleMetadataMappingNext);
    if (metadataMappingBackBtn) metadataMappingBackBtn.addEventListener('click', handleMetadataMappingBack);
    if (metadataMappingSaveBtn) metadataMappingSaveBtn.addEventListener('click', handleSaveMetadataMapping);

    // View Modal Listeners
    if (viewMappingBtn) viewMappingBtn.addEventListener('click', openViewMappingModal);
    if (closeViewMappingModalBtn) closeViewMappingModalBtn.addEventListener('click', () => viewMappingModal.classList.add('hidden'));
    if (closeViewMappingModalFooterBtn) closeViewMappingModalFooterBtn.addEventListener('click', () => viewMappingModal.classList.add('hidden'));
}

function renderFullMappingInterface(mode) {
    const modalBody = document.getElementById('metadataMappingModalBody');
    const modalTitle = document.getElementById('metadataMappingModalTitle');
    const saveBtn = document.getElementById('metadataMappingSaveBtn');
    const statusEl = document.getElementById('metadataMappingStatus');
    const existingMapping = appDataCache.mappings?.[0]?.column_definitions ? JSON.parse(appDataCache.mappings[0].column_definitions) : {};

    if(saveBtn) saveBtn.classList.remove('hidden');
    
    let headerHtml = '';
    // Conditionally show the file selection UI
    if (mode === 'file') {
        modalTitle.textContent = 'Configure File-based Metadata Mapping';
        const filePath = mappingData.metadataFilePath || existingMapping._file_path || '';

        headerHtml = `
            <div id="fileMappingDetailsContainer">
                <div class="mb-4 p-4 border rounded-md bg-gray-50">
                    <label class="block text-sm font-medium text-gray-700 mb-1">1. Select Metadata Source File</label>
                    <p class="text-xs text-gray-600 mb-2">Select a CSV or Excel file. Columns will be detected automatically.</p>
                    <div class="flex items-center gap-2">
                        <input type="text" id="pipelineMetadataFilePath" class="file-path-input" value="${filePath}" placeholder="No file selected..." readonly>
                        <button id="browsePipelineMetadataFileBtn" class="btn-primary text-sm">Browse...</button>
                    </div>
                </div>
                <div id="fileDependentControls" class="mb-4 p-4 border rounded-md bg-blue-50 border-blue-200 ${filePath ? '' : 'opacity-50 pointer-events-none'}">
                    <label for="pipelineFilenameColumn" class="block text-sm font-bold text-gray-800 mb-1">2. Confirm Filename Linkage Column <span class="text-red-500">*</span></label>
                    <p class="text-xs text-gray-600 mb-2">This column links spreadsheet rows to project files.</p>
                    <select id="pipelineFilenameColumn" class="mt-1 block w-full p-2 border rounded-md bg-white"></select>
                    <div class="mt-3">
                        <label for="pipelineModalityTemplate" class="block text-xs font-medium text-gray-700 mb-1">Modality Template (Optional)</label>
                        <select id="pipelineModalityTemplate" class="mt-1 block w-full p-2 border rounded-md bg-white text-xs"></select>
                    </div>
                    <details class="mt-3">
                        <summary class="text-xs font-medium text-blue-600 cursor-pointer">Show File Preview</summary>
                        <div id="metadataFileDataPreviewEl" class="text-xs border rounded-md p-2 mt-2 max-h-32 overflow-auto bg-white"></div>
                    </details>
                </div>
                <h3 class="text-lg font-semibold text-gray-800 mb-3 pb-2 border-b">3. Configure Field Mappings</h3>
            </div>
        `;
    } else { // Generic Mode
        modalTitle.textContent = 'Configure Generic Metadata Mapping';
    }

    modalBody.innerHTML = `
        <div id="metadataMappingStatus" class="text-sm text-gray-600 mb-4"></div>
        ${headerHtml}
        <div id="dynamicMappingFormContainer"></div>
    `;

    const statusElement = document.getElementById('metadataMappingStatus');
    if (statusElement) statusElement.textContent = '';


    // Attach event listeners and initialize the dynamic form
    if (mode === 'file') {
        document.getElementById('browsePipelineMetadataFileBtn').onclick = handleBrowseAndLoadFile;
        // If a file path already exists, automatically load its details
        const filePath = mappingData.metadataFilePath || existingMapping._file_path || '';
        if (filePath) {
            handleBrowseAndLoadFile(filePath);
        }
    }
    
    // Initialize the main mapping form
    initializeFieldMappingUI(
        document.getElementById('dynamicMappingFormContainer'),
        window.zenodoMappingSchema,
        mappingData.columns, // Pass currently loaded columns
        existingMapping
    );
}

async function handleBrowseAndLoadFile(existingPath = null) {
    const statusEl = document.getElementById('metadataMappingStatus');
    statusEl.textContent = 'Loading file...';

    try {
        const filePath = existingPath && typeof existingPath === 'string' 
            ? existingPath 
            : await window.electronAPI.openFile({ filters: [{ name: 'Spreadsheets', extensions: ['csv', 'xlsx', 'xls'] }] });

        if (!filePath) {
            statusEl.textContent = 'File selection cancelled.';
            return;
        }

        document.getElementById('pipelineMetadataFilePath').value = filePath;
        mappingData.metadataFilePath = filePath;
        mappingData.mappingMode = 'file';

        const previewResponse = await fetch(`${PYTHON_API_BASE_URL}/api/project/metadata/load_file_preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: filePath, fileFormat: filePath.endsWith('.csv') ? 'csv' : 'excel' })
        });
        const result = await previewResponse.json();
        if (!result.success) throw new Error(result.error);

        mappingData.columns = result.columns || [];
        mappingData.previewData = result.previewData || [];

        // --- UI Updates after successful file load ---
        const fileDependentControls = document.getElementById('fileDependentControls');
        fileDependentControls.classList.remove('opacity-50', 'pointer-events-none');

        // Populate filename dropdown
        const filenameDropdown = document.getElementById('pipelineFilenameColumn');
        filenameDropdown.innerHTML = '<option value="">-- Select Filename Column --</option>' + mappingData.columns.map(c => `<option value="${c}">${c}</option>`).join('');
        
        // Populate modality template dropdown
        const modalityTemplateDropdown = document.getElementById('pipelineModalityTemplate');
        modalityTemplateDropdown.innerHTML = '<option value="">-- Apply a Template (Optional) --</option>'; // TODO: Add MODALITY_OPTIONS here (global)

        // Show file preview
        const previewEl = document.getElementById('metadataFileDataPreviewEl');
        let tableHtml = '<table class="w-full text-left border-collapse"><thead><tr class="bg-gray-100">';
        mappingData.columns.forEach(col => tableHtml += `<th class="border p-1 text-xs">${col}</th>`);
        tableHtml += '</tr></thead><tbody>';
        mappingData.previewData.forEach(row => {
            tableHtml += '<tr>';
            mappingData.columns.forEach(col => {
                const cellValue = row[col] !== null && row[col] !== undefined ? String(row[col]) : '';
                tableHtml += `<td class="border p-1 text-xs">${cellValue.substring(0, 50)}</td>`;
            });
            tableHtml += '</tr>';
        });
        tableHtml += '</tbody></table>';
        previewEl.innerHTML = tableHtml;

        // Re-initialize the mapping UI with the new columns available
        initializeFieldMappingUI(
            document.getElementById('dynamicMappingFormContainer'),
            window.zenodoMappingSchema,
            mappingData.columns,
            appDataCache.mappings?.[0]?.column_definitions ? JSON.parse(appDataCache.mappings[0].column_definitions) : {}
        );
        
        statusEl.textContent = 'File loaded successfully. Please configure mappings.';

    } catch (error) {
        statusEl.textContent = `Error: ${error.message}`;
        console.error("Error loading metadata file:", error);
    }
}