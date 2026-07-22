# Contributing

Thanks for your interest in contributing to Smart Quiz Tutor!

## Development Setup

```bash
git clone https://github.com/xxinjie21/question-generator.git
cd question-generator
npm install
```

### Build

```bash
npm run build    # production build
npm run dev      # watch mode (auto-rebuild on changes)
```

### Lint

```bash
npm run lint
```

## Project Structure

```
src/
  main.ts          # All plugin logic (~3400 lines)
```

## Making Changes

1. Fork the repo and create a feature branch: `git checkout -b feat/my-feature`
2. Make your changes in `src/main.ts`
3. Run `npm run lint` and `npm run build` to verify
4. Test manually in Obsidian (copy `main.js`/`manifest.json`/`styles.css` to your vault)
5. Submit a pull request

## Pull Request Guidelines

- Keep changes focused — one PR per feature/fix
- Update README if your change affects user-facing behavior
- Make sure the build passes (`npm run build`)

## Release Process

Maintained by the project owner:

1. Update `version` in `manifest.json`
2. Add version mapping in `versions.json`
3. Commit and tag: `git tag <version> && git push --tags`
4. GitHub Actions creates the release automatically

## Code Style

- TypeScript, strict mode
- No semicolons (project convention)
- Indent with tabs
- Import type utilities from `obsidian` module
