// src/renderer/js/views/operability.js

import { PYTHON_API_BASE_URL } from '../core/api.js';
import { isProjectLoaded } from '../core/state.js';
import { showToast } from '../core/ui.js';
import { addToLog } from '../renderer.js';

// --- DOM Elements ---
const operabilityBtn = document.getElementById('operabilityBtn');
const operabilityModal = document.getElementById('operabilityModal');
const closeOperabilityModalBtn = document.getElementById('closeOperabilityModalBtn');
const operabilityTestsList = document.getElementById('operabilityTestsList');
const noOperabilityTestsMessageEl = document.getElementById('noOperabilityTestsMessage');
const runAllTestsBtn = document.getElementById('runAllTestsBtn');

// --- State ---
let operabilityTests = [];

// --- Core Functions ---

/**
 * Loads the list of operability tests from the backend and displays them in the modal.
 */
export async function loadOperabilityTests() {
    if (!operabilityTestsList) return;
    operabilityTestsList.innerHTML = '<p class="text-gray-500">Loading tests...</p>';
    const projectIsLoaded = isProjectLoaded();

    try {
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/operability/tests`);
        if (!response.ok) throw new Error(`Failed to fetch tests: ${response.statusText}`);

        const tests = await response.json();
        operabilityTestsList.innerHTML = '';
        if (noOperabilityTestsMessageEl) noOperabilityTestsMessageEl.classList.add('hidden');

        tests.forEach(test => {
            const testRequiresProject = (test.id === 'test_db_integrity_check');
            const canRunTest = !testRequiresProject || projectIsLoaded;

            const testDiv = document.createElement('div');
            testDiv.className = 'operability-test-item p-4 border rounded-lg flex items-start justify-between transition-colors hover:bg-gray-50';

            let runButtonHtml = `<button data-testid="${test.id}" class="run-test-btn btn-secondary text-sm py-1 px-3">Run</button>`;
            let tooltipHtml = '';

            if (!canRunTest) {
                runButtonHtml = `<button data-testid="${test.id}" class="run-test-btn btn-secondary text-sm py-1 px-3" disabled>Run</button>`;
                tooltipHtml = `<p class="text-xs text-gray-400 mt-1">Requires a .hdpc project to be loaded.</p>`;
            }

            testDiv.innerHTML = `
                <div class="flex-grow pr-4">
                    <p class="font-medium text-gray-800">${test.name}</p>
                    ${tooltipHtml}
                    <div class="test-result-message text-xs mt-2 p-2 bg-gray-50 rounded-md" style="display: none; white-space: pre-wrap; word-break: break-word;"></div>
                </div>
                <div class="flex items-center space-x-3 flex-shrink-0">
                    <div class="test-status-indicator"></div>
                    ${runButtonHtml}
                </div>`;
            operabilityTestsList.appendChild(testDiv);
        });
    } catch (error) {
        console.error('Error loading operability tests:', error);
        // Fallback to mock data if available in the cache
        if (appDataCache && appDataCache.operabilityTests) {
            showToast("Could not load operability tests from backend. Using mock data.", "warning");
            const tests = appDataCache.operabilityTests;
            operabilityTestsList.innerHTML = ''; // Clear previous error message
            tests.forEach(test => {
                const testRequiresProject = (test.id === 'test_db_integrity_check');
                const canRunTest = !testRequiresProject || projectIsLoaded;
                const testDiv = document.createElement('div');
                testDiv.className = 'operability-test-item p-4 border rounded-lg flex items-start justify-between transition-colors hover:bg-gray-50';
                let runButtonHtml = `<button data-testid="${test.id}" class="run-test-btn btn-secondary text-sm py-1 px-3">Run</button>`;
                let tooltipHtml = '';
                if (!canRunTest) {
                    runButtonHtml = `<button data-testid="${test.id}" class="run-test-btn btn-secondary text-sm py-1 px-3" disabled>Run</button>`;
                    tooltipHtml = `<p class="text-xs text-gray-400 mt-1">Requires a .hdpc project to be loaded.</p>`;
                }
                testDiv.innerHTML = `
                    <div class="flex-grow pr-4">
                        <p class="font-medium text-gray-800">${test.name}</p>
                        ${tooltipHtml}
                        <div class="test-result-message text-xs mt-2 p-2 bg-gray-50 rounded-md" style="display: none; white-space: pre-wrap; word-break: break-word;"></div>
                    </div>
                    <div class="flex items-center space-x-3 flex-shrink-0">
                        <div class="test-status-indicator"></div>
                        ${runButtonHtml}
                    </div>`;
                operabilityTestsList.appendChild(testDiv);
            });
        } else {
            operabilityTestsList.innerHTML = '';
            if (noOperabilityTestsMessageEl) {
                noOperabilityTestsMessageEl.textContent = `Error: ${error.message}`;
                noOperabilityTestsMessageEl.classList.remove('hidden');
            }
        }
    }
}

/**
 * Runs a single operability test and updates its specific UI element.
 * @param {Event} event - The click event from the "Run" button.
 */
async function handleSingleTestRun(event) {
    const button = event.target.closest('.run-test-btn');
    if (!button) return;

    const testId = button.dataset.testid;
    if (!testId || button.disabled) return;

    const testItem = button.closest('.operability-test-item');
    const statusIndicator = testItem.querySelector('.test-status-indicator');
    const resultMessageElement = testItem.querySelector('.test-result-message');

    button.disabled = true;
    statusIndicator.innerHTML = '<div class="loader-sm"></div>';
    statusIndicator.className = 'test-status-indicator running';
    if (resultMessageElement) {
        resultMessageElement.style.display = 'none';
        resultMessageElement.textContent = '';
        resultMessageElement.classList.remove('text-red-700', 'text-amber-700', 'text-gray-600');
    }
    addToLog('Operability Test', `Running test: ${testId}`);

    try {
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/operability/run/${testId}`, { method: 'POST' });
        const result = await response.json();
        addToLog('Operability Test', `Result for ${testId}: ${result.status} - ${result.message}`);

        if (result.message && resultMessageElement) {
            resultMessageElement.textContent = result.message;
            resultMessageElement.style.display = 'block';
        }

        if (result.status === 'success') {
            statusIndicator.innerHTML = '✔️';
            statusIndicator.className = 'test-status-indicator success';
            if (resultMessageElement) resultMessageElement.classList.add('text-gray-600');
        } else {
            statusIndicator.innerHTML = '❌';
            statusIndicator.className = 'test-status-indicator failure';
            if (resultMessageElement) resultMessageElement.classList.add('text-red-700');
        }
    } catch (error) {
        console.error(`Error running test ${testId}:`, error);
        statusIndicator.innerHTML = '⚠️';
        statusIndicator.className = 'test-status-indicator error';
        if (resultMessageElement) {
            resultMessageElement.textContent = `A network or script error occurred: ${error.message}`;
            resultMessageElement.style.display = 'block';
            resultMessageElement.classList.add('text-amber-700');
        }
        addToLog('Operability Test', `Error running test ${testId}: ${error.message}`);
    } finally {
        button.disabled = false;
    }
}


// --- Initialization ---
export function initOperabilityTests() {
    if (operabilityBtn) {
        operabilityBtn.addEventListener('click', () => {
            operabilityModal.classList.remove('hidden');
            loadOperabilityTests();
        });
    }

    if (closeOperabilityModalBtn) {
        closeOperabilityModalBtn.addEventListener('click', () => {
            operabilityModal.classList.add('hidden');
        });
    }

    if (operabilityTestsList) {
        operabilityTestsList.addEventListener('click', handleSingleTestRun);
    }

    if (runAllTestsBtn) {
        runAllTestsBtn.addEventListener('click', async () => {
            const allRunButtons = operabilityTestsList.querySelectorAll('.run-test-btn:not(:disabled)');
            if (allRunButtons.length === 0) {
                showToast("No tests available to run.", "info");
                return;
            }

            runAllTestsBtn.disabled = true;
            for (const button of allRunButtons) {
                // We can simulate a click event to reuse the single-run handler
                await handleSingleTestRun({ target: button });
            }
            runAllTestsBtn.disabled = false;
            showToast("All operability tests completed.", "info");
        });
    }
}