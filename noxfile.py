#!/usr/bin/env -S uv run --script

# /// script
# dependencies = ["nox>=2025.2.9"]
# ///

"""Nox sessions for local development and CI."""

from __future__ import annotations

import shutil
from pathlib import Path

import nox

ROOT = Path(__file__).parent.resolve()
PROJECT = nox.project.load_toml()

nox.needs_version = ">=2025.2.9"
nox.options.default_venv_backend = "uv|virtualenv"


@nox.session
def lint(session: nox.Session) -> None:
    """Run all repository hooks."""
    session.install("prek>=0.2")
    session.run("prek", "run", "--all-files", "--show-diff-on-failure", *session.posargs)


@nox.session
def tests(session: nox.Session) -> None:
    """Run unit tests with optional pytest arguments."""
    dependencies = nox.project.dependency_groups(PROJECT, "test")
    session.install("-e", ".", *dependencies)
    session.run("pytest", *session.posargs)


@nox.session(reuse_venv=True, default=False)
def docs(session: nox.Session) -> None:
    """Build the documentation, or serve it in an interactive terminal."""
    dependencies = nox.project.dependency_groups(PROJECT, "docs")
    session.install("-e", ".", *dependencies)
    command = "serve" if session.interactive else "build"
    arguments = ["--strict"] if command == "build" else []
    session.run("mkdocs", command, *arguments, *session.posargs)


@nox.session(default=False)
def build(session: nox.Session) -> None:
    """Build and validate the source and wheel distributions."""
    dist = ROOT / "dist"
    if dist.exists():
        shutil.rmtree(dist)
    session.install("build>=1.2", "twine>=6")
    session.run("python", "-m", "build")
    artifacts = sorted(str(path) for path in dist.iterdir())
    session.run("twine", "check", *artifacts)


if __name__ == "__main__":
    nox.main()
