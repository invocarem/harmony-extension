// Mock for vscode module
export const workspace = {
  asRelativePath: jest.fn((pathOrUri: string | any, includeWorkspaceFolder?: boolean) => {
    // Convert Uri to string if needed, otherwise return as-is
    return typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.fsPath || pathOrUri.toString();
  }),
};

export default {
  workspace,
};

