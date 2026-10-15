// Voice input helpers shared by the transcribe route and the tests.

/** Words a person could say in `sec` seconds, generously: a transcript well past this was made up by the model. */
export const plausibleWords = (sec: number) => Math.max(8, sec * 5);
