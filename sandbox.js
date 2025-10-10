import vm from 'vm';

/**
 * Executes a script in a sandboxed environment using Node.js's native vm module.
 * @param {string} scriptCode The JavaScript code to execute.
 * @param {object} params The parameters to make available to the script.
 * @returns {Promise<any>} A promise that resolves with the script's result.
 */
export async function executeInSandbox(scriptCode, params = {}) {
  const context = {
    params,
    result: null, // The script is expected to set this variable.
    console: {
      log: (...args) => console.log('[Sandbox Log]', ...args)
    }
  };

  vm.createContext(context);

  try {
    vm.runInContext(scriptCode, context, { timeout: 1000 }); // 1-second timeout
    return { success: true, result: context.result };
  } catch (err) {
    console.error('[Sandbox] Script execution error:', err.message);
    return { success: false, error: err.message };
  }
}
