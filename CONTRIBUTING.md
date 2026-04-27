# Contributing to DevLedger

Thank you for your interest in contributing to DevLedger! As a local-first, privacy-focused project, we value contributions that respect these core principles.

## Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/whaiman/dev-ledger.git
   cd dev-ledger
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   ```

3. **Build the project**:
   ```bash
   pnpm build
   ```

## Project Structure

- `packages/core`: The heart of DevLedger. Contains hashing, aggregation, and visualization logic.
- `packages/cli`: Command-line interface for managing logs and generating reports.
- `packages/vscode-extension`: The event collector for VS Code.

## Coding Guidelines

- **Privacy First**: Never add features that require external network access or collect personally identifiable information.
- **Immutability**: Ensure that new features respect the append-only nature of the event log.
- **Type Safety**: We use TypeScript for all packages. Ensure your changes are fully typed.

## Submitting Changes

1. Create a new branch for your feature or bugfix.
2. Ensure tests pass by running `pnpm --filter @devledger/core test`.
3. Submit a Pull Request with a clear description of your changes.

## Security

If you find a security vulnerability, please do not open a public issue. Instead, contact the maintainers directly.
