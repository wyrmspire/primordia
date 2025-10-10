// This file contains the hard-coded business logic of your service.

// A simple task that adds two numbers based on config.
async function add(config) {
  const { a, b } = config;
  if (typeof a !== 'number' || typeof b !== 'number') {
    throw new Error("Parameters 'a' and 'b' must be numbers.");
  }
  return { result: a + b };
}

// A task that creates a greeting message.
async function greet(config) {
  const { name, message = "Hello" } = config; // Uses a default value
  if (!name) {
    throw new Error("Parameter 'name' is required.");
  }
  return { greeting: `${message}, ${name}!` };
}

// The task registry. This maps a task name to its function.
export const taskRegistry = {
  add,
  greet,
};
