import { VM } from 'vm2';

/**
 * Executes a script in a sandboxed environment.
 * @param {string} scriptCode The JavaScript code to execute.
 * @param {object} params The parameters to make available to the script.
 * @returns {Promise<any>} A promise that resolves with the script's result.
 */
export async function executeInSandbox(scriptCode, params = {}) {
  // We use the vm2 library for a more secure and robust sandbox than the native 'vm' module.
  // It protects against prototype pollution and other vulnerabilities.
  const vm = new VM({
    timeout: 1000, // 1-second timeout to prevent infinite loops
    sandbox: {
      params, // The 'params' object from the request body
      result: null, // A variable the script is expected to set
    },
    eval: false,
    wasm: false,
  });

  try {
    // Run the script. The script should assign its output to the 'result' variable.
    vm.run(scriptCode);
    const scriptResult = vm.getGlobal('result');
    return { success: true, result: scriptResult };
  } catch (err) {
    console.error('[Sandbox] Script execution error:', err.message);
    return { success: false, error: err.message };
  }
}
