import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import {
  aggregateResolutions,
  analyzeBibliography,
  analyzeReferences,
  clearCrossrefCache,
  isPaperBibliographyOverLimit,
  loadPaperBibliography,
  PaperLinkError,
  parseReference,
  parseReferences,
  resultToCsv,
  resultToJson,
  type PaperBibliography,
} from "./lib";

const MAX_REFERENCES = 100;
const GITHUB_URL = "https://github.com/TomasOrtega/get-commonly-cited";
const SPONSORS_URL = "https://github.com/sponsors/TomasOrtega";
const DOCS_URL = "./docs/";
const ACCEPTED_EXTENSIONS = ["txt", "bib", "ris"];

const EXAMPLE_INPUT = `Tversky, A., & Kahneman, D. (1974). Judgment under uncertainty: Heuristics and biases. Science, 185(4157), 1124–1131. https://doi.org/10.1126/science.185.4157.1124

Kahneman, D., & Tversky, A. (1979). Prospect theory: An analysis of decision under risk. Econometrica, 47(2), 263–291. https://doi.org/10.2307/1914185

Tversky, A., & Kahneman, D. (1981). The framing of decisions and the psychology of choice. Science, 211(4481), 453–458. https://doi.org/10.1126/science.7455683`;

type RankingMode = "full" | "fractional";
type SourceMode = "paper" | "references";
type AnalysisData = Awaited<ReturnType<typeof analyzeBibliography>>;
type Resolution = AnalysisData["resolutions"][number];
type Progress = {
  current: number | null;
  total: number | null;
  reference: { raw: string };
  label: string;
};

function downloadBlob(contents: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadCsv(result: AnalysisData): void {
  downloadBlob(
    resultToCsv(result),
    "commonly-cited-ranking.csv",
    "text/csv;charset=utf-8",
  );
}

function downloadJson(result: AnalysisData): void {
  downloadBlob(
    resultToJson(result),
    "commonly-cited-audit.json",
    "application/json;charset=utf-8",
  );
}

function formatStatus(status: Resolution["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function App() {
  const [sourceMode, setSourceMode] = useState<SourceMode>("references");
  const [input, setInput] = useState("");
  const [paperLink, setPaperLink] = useState("");
  const [paperLinkInvalid, setPaperLinkInvalid] = useState(false);
  const [paperBibliography, setPaperBibliography] = useState<PaperBibliography | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [ranking, setRanking] = useState<RankingMode>("full");
  const [includeCollective, setIncludeCollective] = useState(false);
  const [result, setResult] = useState<AnalysisData | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cacheNotice, setCacheNotice] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const stopButtonRef = useRef<HTMLButtonElement>(null);

  const referenceCount = useMemo(() => {
    if (!input.trim()) return 0;
    try {
      return parseReferences(input).length;
    } catch {
      return 0;
    }
  }, [input]);
  const paperReferenceCount = paperBibliography?.references.length ?? 0;
  const isOverLimit = sourceMode === "paper"
    ? paperBibliography !== null && isPaperBibliographyOverLimit(paperBibliography, MAX_REFERENCES)
    : referenceCount > MAX_REFERENCES;
  const hasSourceInput = sourceMode === "paper" ? Boolean(paperLink.trim()) : Boolean(input.trim());
  const displayedResult = useMemo(
    () => result
      ? aggregateResolutions(result.resolutions, {
          deduplicate: true,
          includeCollective,
          ranking,
          top: 0,
        })
      : null,
    [includeCollective, ranking, result],
  );
  const unresolved = useMemo(
    () => displayedResult?.resolutions.filter((resolution) => resolution.status !== "matched") ?? [],
    [displayedResult],
  );

  useEffect(() => {
    if (result) resultsHeadingRef.current?.focus();
  }, [result]);

  useEffect(() => {
    if (isAnalyzing) stopButtonRef.current?.focus();
  }, [isAnalyzing]);

  async function handleFile(file: File): Promise<void> {
    setError(null);
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !ACCEPTED_EXTENSIONS.includes(extension)) {
      setError("Choose a plain-text, BibTeX (.bib), or RIS (.ris) file.");
      return;
    }
    if (file.size > 1_000_000) {
      setError("That file is larger than 1 MB. Please use a smaller bibliography.");
      return;
    }
    try {
      const contents = await file.text();
      setInput(contents);
      setFilename(file.name);
      setResult(null);
    } catch {
      setError("The file could not be read. Try saving it as UTF-8 text.");
    }
  }

  function loadExample(): void {
    setInput(EXAMPLE_INPUT);
    setFilename(null);
    setResult(null);
    setError(null);
  }

  function changeSourceMode(mode: SourceMode): void {
    setSourceMode(mode);
    setResult(null);
    setError(null);
    setPaperLinkInvalid(false);
  }

  function reset(): void {
    abortControllerRef.current?.abort();
    setSourceMode("references");
    setInput("");
    setPaperLink("");
    setPaperLinkInvalid(false);
    setPaperBibliography(null);
    setFilename(null);
    setResult(null);
    setProgress(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    window.scrollTo({ top: 0 });
  }

  async function runAnalysis(): Promise<void> {
    if (!hasSourceInput) {
      setError(
        sourceMode === "paper"
          ? "Enter a paper link first."
          : "Paste a reference list or choose a file first.",
      );
      return;
    }
    if (isOverLimit) {
      setError(
        sourceMode === "paper"
          ? `Crossref returned ${paperReferenceCount} usable references; the browser limit is ${MAX_REFERENCES}.`
          : `This browser version accepts up to ${MAX_REFERENCES} references at a time.`,
      );
      return;
    }

    setError(null);
    setPaperLinkInvalid(false);
    setResult(null);
    setIsAnalyzing(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      let paperReferences: ReturnType<typeof parseReference>[] | null = null;
      let analysisReferenceCount = referenceCount;
      if (sourceMode === "paper") {
        setPaperBibliography(null);
        setProgress({
          current: null,
          total: null,
          reference: { raw: paperLink },
          label: "Loading paper references",
        });
        const bibliography = await loadPaperBibliography(paperLink, {
          signal: controller.signal,
        });
        setPaperBibliography(bibliography);
        analysisReferenceCount = bibliography.references.length;
        if (isPaperBibliographyOverLimit(bibliography, MAX_REFERENCES)) {
          setError(
            `Crossref returned ${analysisReferenceCount} usable references; the browser limit is ${MAX_REFERENCES}.`,
          );
          return;
        }
        paperReferences = bibliography.references.map(
          (reference, index) => parseReference(reference, index + 1),
        );
      }

      setProgress({
        current: 0,
        total: analysisReferenceCount,
        reference: { raw: "Preparing references" },
        label: "Checking Crossref",
      });
      const options = {
        ranking,
        top: 0,
        includeCollective,
        signal: controller.signal,
      };
      const onProgress = (event: Omit<Progress, "label">) => {
        setProgress({ ...event, label: "Checking Crossref" });
      };
      const nextResult = paperReferences
        ? await analyzeReferences(paperReferences, options, onProgress)
        : await analyzeBibliography(input, options, onProgress);
      if (nextResult.summary.inputReferences > MAX_REFERENCES) {
        setError(`This list contains ${nextResult.summary.inputReferences} references; the limit is ${MAX_REFERENCES}.`);
        return;
      }
      setResult(nextResult);
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") {
        setError("Analysis stopped. Your source input is still here when you are ready.");
        return;
      }
      if (caught instanceof PaperLinkError && caught.code === "invalid_link") {
        setPaperLinkInvalid(true);
      }
      const message = caught instanceof Error ? caught.message : "The analysis could not be completed.";
      setError(message);
    } finally {
      abortControllerRef.current = null;
      setIsAnalyzing(false);
      setProgress(null);
    }
  }

  return (
    <>
      <a className="skip-link" href="#analysis-workspace">Skip to analyzer</a>
      <header>
        <a href="./"><strong>Commonly Cited</strong></a>
        <nav aria-label="Main navigation">
          <a href={DOCS_URL}>Documentation</a>
          <a href="./docs/privacy/">Privacy &amp; limits</a>
          <a href={GITHUB_URL}>GitHub</a>
        </nav>
      </header>

      <main>
        <h1>Who keeps showing up in your bibliography?</h1>
        <p>
          Rank the people behind your cited works, including coauthors hidden
          behind <em>et al.</em> No account or API key required.
        </p>

        <form
          id="analysis-workspace"
          tabIndex={-1}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void runAnalysis();
          }}
        >
          <fieldset>
            <legend>Start with</legend>
            <label>
              <input type="radio" name="source-mode" value="references"
                checked={sourceMode === "references"}
                onChange={() => changeSourceMode("references")} disabled={isAnalyzing} />
              Reference list
            </label>
            <label>
              <input type="radio" name="source-mode" value="paper"
                checked={sourceMode === "paper"}
                onChange={() => changeSourceMode("paper")} disabled={isAnalyzing} />
              Paper link
            </label>
          </fieldset>

          <h2>{sourceMode === "paper" ? "Link to a paper" : "Paste a reference list"}</h2>
          {sourceMode === "paper" ? (
            <>
              <label htmlFor="paper-link">Paper link</label>
              <input
                id="paper-link"
                type="url"
                inputMode="url"
                autoComplete="url"
                value={paperLink}
                onChange={(event) => {
                  setPaperLink(event.target.value);
                  setPaperBibliography(null);
                  setResult(null);
                  setError(null);
                  setPaperLinkInvalid(false);
                }}
                placeholder="https://doi.org/10.1000/example"
                disabled={isAnalyzing}
                aria-describedby="paper-link-guidance"
                aria-invalid={paperLinkInvalid}
                aria-errormessage={paperLinkInvalid ? "analysis-error" : undefined}
              />
              <p id="paper-link-guidance">
                Use a doi.org link or a publisher URL containing the DOI.
                References must be deposited with Crossref; {MAX_REFERENCES} usable references max.
              </p>
              {paperBibliography && (
                <p role="status">
                  <strong>{paperBibliography.title}</strong><br />
                  {paperReferenceCount} usable references loaded.
                  {paperBibliography.skippedReferences > 0 &&
                    " " + paperBibliography.skippedReferences + " incomplete records skipped."}
                </p>
              )}
            </>
          ) : (
            <>
              <label htmlFor="bibliography-input">Bibliography text</label>
              <textarea
                id="bibliography-input"
                rows={8}
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  setFilename(null);
                  setResult(null);
                  setError(null);
                }}
                placeholder={"Paste references here…\n\nNumbered lists, BibTeX, RIS, DOIs, and wrapped citations are welcome."}
                spellCheck={false}
                disabled={isAnalyzing}
                aria-describedby="input-guidance input-count"
                aria-invalid={isOverLimit}
              />
              <div className="actions">
                <button type="button" onClick={loadExample} disabled={isAnalyzing}>Use an example</button>
                <label htmlFor="bibliography-file">Or upload a file:</label>
                <input
                  ref={fileInputRef}
                  id="bibliography-file"
                  type="file"
                  accept=".txt,.bib,.ris,text/plain,application/x-bibtex,application/x-research-info-systems"
                  aria-describedby="input-guidance"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void handleFile(file);
                      event.currentTarget.value = "";
                    }
                  }}
                  disabled={isAnalyzing}
                />
              </div>
              <p id="input-guidance">TXT, BIB, or RIS · 1 MB max{filename && " · Loaded: " + filename}</p>
              <p id="input-count" className={isOverLimit ? "error" : undefined}>
                {referenceCount} parsed {referenceCount === 1 ? "reference" : "references"} / {MAX_REFERENCES} max
              </p>
            </>
          )}

          <fieldset>
            <legend>Ranking method</legend>
            <label>
              <input type="radio" name="ranking" value="full" checked={ranking === "full"}
                onChange={() => setRanking("full")} disabled={isAnalyzing} />
              Full count
            </label>
            <label>
              <input type="radio" name="ranking" value="fractional" checked={ranking === "fractional"}
                onChange={() => setRanking("fractional")} disabled={isAnalyzing} />
              Fractional
            </label>
            <details className="ranking-help">
              <summary>How are these counted?</summary>
              <p><strong>Full count:</strong> Each author gets 1 for each distinct matched work.</p>
              <p>
                <strong>Fractional:</strong> Each work contributes 1 in total, split equally
                among its counted authors. A work with four counted authors gives each 0.25.
                Collectives share that credit when included.
              </p>
              <p>Choose full count for frequency; fractional gives less weight to large author lists.</p>
            </details>
          </fieldset>
          <label>
            <input type="checkbox" checked={includeCollective}
              onChange={(event) => setIncludeCollective(event.target.checked)} disabled={isAnalyzing} />
            Include collectives (consortia, committees, and study groups)
          </label>

          {error && <p id="analysis-error" className="error" role="alert">{error}</p>}
          {isAnalyzing && progress ? (
            <div aria-live="polite" aria-atomic="true">
              <p>
                {progress.label}
                {progress.current !== null && progress.total !== null &&
                  " · " + progress.current + " of " + progress.total}
              </p>
              <progress aria-label={progress.label}
                value={progress.current ?? undefined} max={progress.total ?? undefined} />
              <p>{progress.reference.raw}</p>
              <button ref={stopButtonRef} type="button" onClick={() => abortControllerRef.current?.abort()}>
                Stop analysis
              </button>
            </div>
          ) : (
            <p>
              <button type="submit" disabled={!hasSourceInput || isOverLimit}>
                {sourceMode === "paper" ? "Analyze paper" : "Analyze bibliography"}
              </button>
            </p>
          )}
        </form>

        {displayedResult && (
          <Results result={displayedResult} ranking={ranking} unresolved={unresolved}
            headingRef={resultsHeadingRef} onReset={reset} />
        )}
      </main>

      <footer>
        <span>Commonly Cited · An open-source research utility</span>
        <nav aria-label="Footer navigation">
          <a href={SPONSORS_URL}>Sponsor the developer</a>
          <a href={GITHUB_URL}>BSD-3-Clause</a>
          <button type="button" onClick={() => {
            clearCrossrefCache();
            setCacheNotice("Local metadata cache cleared.");
          }}>Clear local cache</button>
        </nav>
        <span role="status">{cacheNotice}</span>
      </footer>
    </>
  );
}

type ResultsProps = {
  result: AnalysisData;
  ranking: RankingMode;
  unresolved: Resolution[];
  headingRef: RefObject<HTMLHeadingElement | null>;
  onReset: () => void;
};

function Results({ result, ranking, unresolved, headingRef, onReset }: ResultsProps) {
  const { summary } = result;

  return (
    <section aria-labelledby="results-title">
      <h2 id="results-title" ref={headingRef} tabIndex={-1}>Results</h2>
      <div className="actions" role="group" aria-label="Result actions">
        <button type="button" onClick={() => downloadCsv(result)}>Download CSV</button>
        <button type="button" onClick={() => downloadJson(result)}>Download JSON audit</button>
        <button type="button" onClick={onReset}>Start over</button>
      </div>
      <p>
        {summary.inputReferences} references parsed · {summary.distinctMatchedWorks} distinct works ·{" "}
        {summary.rankedPeople} people identified · {summary.hiddenAuthorsExpanded} hidden authors recovered
      </p>
      {result.warnings.length > 0 && (
        <div role="status">
          {result.warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      )}

      <h3>{ranking === "full" ? "Cited works" : "Fractional authorship"}</h3>
      <p>
        {ranking === "full"
          ? "One count per person, per distinct work."
          : "One work divided evenly across its authors."}
      </p>
      {result.people.length ? (
        <div className="table-scroll" role="region" aria-label="People ranking" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Person</th>
                <th scope="col">Cited works</th>
                <th scope="col">Fractional</th>
                <th scope="col">Share</th>
                <th scope="col">Identifier</th>
              </tr>
            </thead>
            <tbody>
              {result.people.map((person, index) => (
                <tr key={person.key}>
                  <td>{index + 1}</td>
                  <th scope="row">
                    {person.displayName}
                    {person.aliases.size > 1 && (
                      <small> ({person.aliases.size - 1} {person.aliases.size === 2 ? "alias" : "aliases"})</small>
                    )}
                  </th>
                  <td>{person.fullCount}</td>
                  <td>{person.fractionalCount.toFixed(3)}</td>
                  <td>{(summary.distinctMatchedWorks
                    ? person.fullCount / summary.distinctMatchedWorks * 100 : 0).toFixed(1)}%</td>
                  <td>
                    {person.orcid ? (
                      <a href={"https://orcid.org/" + person.orcid}>ORCID</a>
                    ) : person.openalexId ? (
                      <a href={person.openalexId.startsWith("http")
                        ? person.openalexId : "https://openalex.org/" + person.openalexId}>OpenAlex</a>
                    ) : "Name only"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p>No people could be ranked from the matched records.</p>}

      <h3>Resolution audit</h3>
      <p>
        {summary.matchedReferences} matched · {summary.ambiguousReferences} ambiguous ·{" "}
        {summary.unmatchedReferences + summary.erroredReferences} unresolved
      </p>
      {unresolved.length ? unresolved.map((resolution) => (
        <details key={resolution.reference.index}>
          <summary>{formatStatus(resolution.status)} · Reference {resolution.reference.index}</summary>
          <p>{resolution.reference.raw}</p>
          <p><strong>Reason:</strong> {resolution.reason ?? "No accepted metadata match was found."}</p>
          <p><strong>Confidence:</strong> {Math.round(resolution.confidence * 100)}%</p>
          {resolution.alternatives.length > 0 && (
            <>
              <h4>Closest candidates</h4>
              <ol>
                {resolution.alternatives.map((candidate) => (
                  <li key={candidate.work.id}>
                    {candidate.work.title} · {Math.round(candidate.score * 100)}%
                  </li>
                ))}
              </ol>
            </>
          )}
          {resolution.providerErrors.length > 0 && (
            <>
              <h4>Provider notes</h4>
              {resolution.providerErrors.map((providerError) => <p key={providerError}>{providerError}</p>)}
            </>
          )}
        </details>
      )) : <p>Nothing needs review. Every parsed reference received a confident match.</p>}
    </section>
  );
}

export default App;
