// src/renderer/js/core/alphaBlocker.js

/**
 * @typedef {Object} AppConfig
 * @property {Object} [developer]
 * @property {boolean} [developer.alpha_features_enabled]
 */

let isAlphaEnabled = false;

/**
 * Initializes the AlphaBlocker with the application configuration.
 * @param {AppConfig} config - The main application configuration object.
 */
export function initAlphaBlocker(config) {
    // Feature flags are enabled if the config specifically says so. Default is false (disabled).
    isAlphaEnabled = config?.developer?.alpha_features_enabled === true;
    console.log(`[AlphaBlocker] Alpha features are ${isAlphaEnabled ? 'ENABLED' : 'DISABLED'}.`);
}

/**
 * Applies the feature blocks to the UI based on the configuration.
 */
export function applyAlphaBlockers() {
    if (isAlphaEnabled) {
        return; // Do nothing if features are enabled
    }

    // Disable specific buttons
    disableButton('settingsBtn', 'Application Configuration is disabled in this version.');
    disableButton('operabilityBtn', 'Operability Tests are disabled in this version.');
    disableButton('modelsBtn', 'Model Management is disabled in this version.');
    disableButton('optimizeBtn', 'Storage optimization is disabled in this version.');

    // Disable specific navigation links
    disableNavLink('apilog', 'API Log is disabled in this version.');
    disableNavLink('mappings', 'Mappings view is disabled in this version.');
    disableNavLink('batches', 'Batches view is disabled in this version.');
    disableNavLink('files', 'Files view is a work in progress and disabled in this version.');
    disableNavLink('pipeline', 'Pipeline view is a work in progress and disabled in this version.');
    disableNavLink('config', 'Configuration view is a work in progress and disabled in this version.');
    disableNavLink('credentials', 'Credentials view is a work in progress and disabled in this version.');
}

/**
 * Disables a button by its ID.
 * @param {string} buttonId - The ID of the button element.
 * @param {string} message - The tooltip message to show on hover.
 */
function disableButton(buttonId, message) {
    const button = document.getElementById(buttonId);
    if (button) {
        button.disabled = true;
        button.title = message;
        button.classList.add('alpha-disabled-button'); // For styling
    }
}

/**
 * Disables a navigation link by its data-view attribute.
 * @param {string} viewId - The data-view attribute value of the nav link.
 * @param {string} message - The tooltip message to show on hover.
 */
function disableNavLink(viewId, message) {
    const navLink = document.querySelector(`.nav-link[data-view="${viewId}"]`);
    if (navLink) {
        navLink.classList.add('alpha-disabled-nav');
        navLink.title = message;
        // Prevent navigation by intercepting the click
        navLink.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            showToast(message, 'info');
        }, true); // Use capture phase to stop event early
    }
}

/**
 * A helper function to re-enable all features if needed dynamically.
 * Note: This is not used in the initial setup but can be useful for debugging.
 */
export function enableAllFeatures() {
    isAlphaEnabled = true;
    document.querySelectorAll('.alpha-disabled-button').forEach(el => {
        el.disabled = false;
        el.title = '';
        el.classList.remove('alpha-disabled-button');
    });
    // Re-enabling nav links would require removing the event listener, which is more complex.
    // A full page reload after changing the config is the most reliable way.
    console.log('[AlphaBlocker] All features have been dynamically re-enabled. A reload is recommended for full functionality.');
}