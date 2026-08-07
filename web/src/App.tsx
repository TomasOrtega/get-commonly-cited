import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import {
  aggregateResolutions,
  analyzeBibliography,
  clearCrossrefCache,
  parseReferences,
  resultToCsv,
  resultToJson,
} from "./lib";

const MAX_REFERENCES = 100;
const GITHUB_URL = "https://github.com/TomasOrtega/get-commonly-cited";
const DOCS_URL = "./docs/";
const ACCEPTED_EXTENSIONS = ["txt", "bib", "ris"];

const EXAMPLE_INPUT = `Tversky, A., & Kahneman, D. (1974). Judgment under uncertainty: Heuristics and biases. Science, 185(4157), 1124–1131. https://doi.org/10.1126/science.185.4157.1124

Kahneman, D., & Tversky, A. (1979). Prospect theory: An analysis of decision under risk. Econometrica, 47(2), 263–291. https://doi.org/10.2307/1914185

Tversky, A., & Kahneman, D. (1981). The framing of decisions and the psychology of choice. Science, 211(4481), 453–458. https://doi.org/10.1126/science.7455683`;

type RankingMode = "full" | "fractional";
type AnalysisData = Awaited<ReturnType<typeof analyzeBibliography>>;
type Resolution = AnalysisData["resolutions"][number];
type Progress = {
  current: number;
  total: number;
  reference: { raw: string };
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
  const [input, setInput] = useState("");
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
  const isOverLimit = referenceCount > MAX_REFERENCES;
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

  function reset(): void {
    abortControllerRef.current?.abort();
    setInput("");
    setFilename(null);
    setResult(null);
    setProgress(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    window.scrollTo({ top: 0 });
  }

  async function runAnalysis(): Promise<void> {
    if (!input.trim()) {
      setError("Paste a reference list or choose a file first.");
      return;
    }
    if (isOverLimit) {
      setError(`This browser version accepts up to ${MAX_REFERENCES} references at a time.`);
      return;
    }

    setError(null);
    setResult(null);
    setIsAnalyzing(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setProgress({ current: 0, total: referenceCount, reference: { raw: "Preparing references" } });
    try {
      const nextResult = await analyzeBibliography(
        input,
        {
          ranking,
          top: 0,
          includeCollective,
          signal: controller.signal,
        },
        (event) => setProgress(event),
      );
      if (nextResult.summary.inputReferences > MAX_REFERENCES) {
        setError(`This list contains ${nextResult.summary.inputReferences} references; the limit is ${MAX_REFERENCES}.`);
        return;
      }
      setResult(nextResult);
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") {
        setError("Analysis stopped. Your bibliography is still here when you are ready.");
        return;
      }
      const message = caught instanceof Error ? caught.message : "The analysis could not be completed.";
      setError(message);
    } finally {
      abortControllerRef.current = null;
      setIsAnalyzing(false);
      setProgress(null);
    }
  }

  const progressPercent = progress?.total
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : 0;

  return (
    <>
      <a className="skip-link" href="#analysis-workspace">
        Skip to analyzer
      </a>
      <header className="site-header">
        <a className="brand" href="./" aria-label="Commonly Cited home">
          <span className="brand-mark" aria-hidden="true">
            <span>C</span><span>C</span>
          </span>
          <span className="brand-copy">
            <strong>Commonly Cited</strong>
            <small>Bibliography analyzer</small>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <a href={DOCS_URL}>Documentation <span aria-hidden="true">↗</span></a>
          <a href={GITHUB_URL}>GitHub <span aria-hidden="true">↗</span></a>
        </nav>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow"><span>01</span> Open research utility</p>
            <h1 id="hero-title">Who keeps showing up in your bibliography?</h1>
            <p className="lede">
              Turn a reference list into a ranked view of the people behind it—including
              coauthors tucked away behind <em>et al.</em>
            </p>
            <div className="method-note">
              <span className="method-rule" aria-hidden="true" />
              <p>
                Matching is intentionally conservative. Uncertain citations stay unresolved
                and visible in the audit instead of being quietly misattributed.
              </p>
            </div>
          </div>

          <div className="workspace" id="analysis-workspace" tabIndex={-1}>
            <div className="workspace-heading">
              <div>
                <p className="step-label">Your source material</p>
                <h2>Paste a reference list</h2>
              </div>
              <button className="text-button" type="button" onClick={loadExample} disabled={isAnalyzing}>
                Use an example
              </button>
            </div>

            <label className="sr-only" htmlFor="bibliography-input">Bibliography text</label>
            <textarea
              id="bibliography-input"
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                setFilename(null);
                setResult(null);
                setError(null);
              }}
              placeholder="Paste references here…\\n\\nNumbered lists, BibTeX, RIS, DOIs, and wrapped citations are welcome."
              spellCheck={false}
              disabled={isAnalyzing}
              aria-describedby="input-guidance input-count"
              aria-invalid={isOverLimit}
            />

            <div className="input-meta">
              <div className="file-control">
                <input
                  ref={fileInputRef}
                  id="bibliography-file"
                  type="file"
                  accept=".txt,.bib,.ris,text/plain,application/x-bibtex,application/x-research-info-systems"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void handleFile(file);
                      event.currentTarget.value = "";
                    }
                  }}
                  disabled={isAnalyzing}
                />
                <label htmlFor="bibliography-file">
                  <span aria-hidden="true">+</span> {filename ?? "Choose a file"}
                </label>
                <span id="input-guidance">TXT, BIB, or RIS · 1 MB max</span>
              </div>
              <p id="input-count" className={isOverLimit ? "count count-error" : "count"}>
                <strong>{referenceCount}</strong> parsed {referenceCount === 1 ? "reference" : "references"}
                <span aria-hidden="true"> / </span>{MAX_REFERENCES} max
              </p>
            </div>

            <div className="controls">
              <fieldset>
                <legend>Ranking method</legend>
                <div className="segmented-control">
                  <label>
                    <input
                      type="radio"
                      name="ranking"
                      value="full"
                      checked={ranking === "full"}
                      onChange={() => setRanking("full")}
                      disabled={isAnalyzing}
                    />
                    <span>Full count</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="ranking"
                      value="fractional"
                      checked={ranking === "fractional"}
                      onChange={() => setRanking("fractional")}
                      disabled={isAnalyzing}
                    />
                    <span>Fractional</span>
                  </label>
                </div>
              </fieldset>

              <label className="toggle-control">
                <input
                  type="checkbox"
                  checked={includeCollective}
                  onChange={(event) => setIncludeCollective(event.target.checked)}
                  disabled={isAnalyzing}
                />
                <span className="toggle" aria-hidden="true"><span /></span>
                <span>
                  Include collectives
                  <small>Consortia, committees, and study groups</small>
                </span>
              </label>
            </div>

            {error && <div className="error-message" role="alert"><span aria-hidden="true">!</span>{error}</div>}

            {isAnalyzing && progress ? (
              <div className="progress-panel" aria-live="polite" aria-atomic="true">
                <div className="progress-copy">
                  <span>Checking Crossref</span>
                  <strong>{progress.current} of {progress.total}</strong>
                </div>
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={progress.total}
                  aria-valuenow={progress.current}
                >
                  <span style={{ width: `${progressPercent}%` }} />
                </div>
                <p>{progress.reference.raw}</p>
                <button ref={stopButtonRef} className="stop-button" type="button" onClick={() => abortControllerRef.current?.abort()}>
                  Stop analysis
                </button>
              </div>
            ) : (
              <div className="analyze-row">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void runAnalysis()}
                  disabled={!input.trim() || isOverLimit}
                >
                  Analyze bibliography <span aria-hidden="true">→</span>
                </button>
                <p>No account or API key required.</p>
              </div>
            )}
          </div>
        </section>

        <section className="how-it-works" aria-labelledby="method-title">
          <div>
            <p className="eyebrow"><span>02</span> Method</p>
            <h2 id="method-title">From citation strings to recurring names.</h2>
          </div>
          <ol>
            <li><span>1</span><p><strong>Parse</strong> messy references into distinct records.</p></li>
            <li><span>2</span><p><strong>Resolve</strong> works against open Crossref metadata.</p></li>
            <li><span>3</span><p><strong>Count</strong> each person once per matched work.</p></li>
          </ol>
        </section>

        {displayedResult && (
          <Results
            result={displayedResult}
            ranking={ranking}
            unresolved={unresolved}
            headingRef={resultsHeadingRef}
            onReset={reset}
          />
        )}

        <section className="privacy-note" aria-labelledby="privacy-title">
          <div className="privacy-index" aria-hidden="true">03</div>
          <div>
            <p className="eyebrow">Privacy &amp; limits</p>
            <h2 id="privacy-title">Runs here. Resolves there.</h2>
          </div>
          <div className="privacy-copy">
            <p>
              Your list is processed in this browser. Individual citations are sent directly
              to Crossref for metadata matching. Responses and their citation queries are cached
              on this device for seven days; this site has no server and stores no result rankings.
            </p>
            <p>
              Crossref quality depends on publisher deposits. Review unresolved and ambiguous
              records before using the ranking in your research.
            </p>
            <a href="./docs/privacy/">Read the privacy notes <span aria-hidden="true">→</span></a>
            <button
              className="cache-button"
              type="button"
              onClick={() => {
                clearCrossrefCache();
                setCacheNotice("Local metadata cache cleared.");
              }}
            >
              Clear local cache
            </button>
            <span className="cache-notice" role="status" aria-live="polite">{cacheNotice}</span>
          </div>
        </section>
      </main>

      <footer>
        <p>Commonly Cited <span>·</span> An open-source research utility</p>
        <a href={GITHUB_URL}>BSD-3-Clause <span aria-hidden="true">↗</span></a>
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
    <section className="results" aria-labelledby="results-title">
      <div className="results-header">
        <div>
          <p className="eyebrow"><span>Results</span> Analysis complete</p>
          <h2 id="results-title" ref={headingRef} tabIndex={-1}>The recurring voices</h2>
        </div>
        <div className="result-actions" role="group" aria-label="Download results">
          <button type="button" onClick={() => downloadCsv(result)}>CSV <span aria-hidden="true">↓</span></button>
          <button type="button" onClick={() => downloadJson(result)}>JSON audit <span aria-hidden="true">↓</span></button>
          <button type="button" onClick={onReset}>Start over <span aria-hidden="true">↺</span></button>
        </div>
      </div>

      <div className="summary-grid" role="group" aria-label="Analysis summary">
        <div><strong>{summary.inputReferences}</strong><span>References parsed</span></div>
        <div><strong>{summary.distinctMatchedWorks}</strong><span>Distinct works</span></div>
        <div><strong>{summary.rankedPeople}</strong><span>People identified</span></div>
        <div><strong>{summary.hiddenAuthorsExpanded}</strong><span>Hidden authors recovered</span></div>
      </div>

      {result.warnings.length > 0 && (
        <div className="warning-list" role="status">
          {result.warnings.map((warning) => <p key={warning}><span aria-hidden="true">!</span>{warning}</p>)}
        </div>
      )}

      <div className="ranking-panel">
        <div className="panel-heading">
          <div>
            <p className="step-label">People ranking</p>
            <h3>{ranking === "full" ? "Cited works" : "Fractional authorship"}</h3>
          </div>
          <p>
            {ranking === "full"
              ? "One count per person, per distinct work"
              : "One work divided evenly across its authors"}
          </p>
        </div>

        {result.people.length ? (
          <div className="table-scroll">
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
                {result.people.map((person, index) => {
                  const share = summary.distinctMatchedWorks
                    ? person.fullCount / summary.distinctMatchedWorks
                    : 0;
                  return (
                    <tr key={person.key}>
                      <td><span className="rank-number">{String(index + 1).padStart(2, "0")}</span></td>
                      <th scope="row">
                        <span>{person.displayName}</span>
                        {person.aliases.size > 1 && <small>{person.aliases.size - 1} {person.aliases.size === 2 ? "alias" : "aliases"}</small>}
                      </th>
                      <td className={ranking === "full" ? "active-metric" : undefined}>{person.fullCount}</td>
                      <td className={ranking === "fractional" ? "active-metric" : undefined}>{person.fractionalCount.toFixed(3)}</td>
                      <td>{(share * 100).toFixed(1)}%</td>
                      <td>
                        {person.orcid ? (
                          <a href={`https://orcid.org/${person.orcid}`}>ORCID <span aria-hidden="true">↗</span></a>
                        ) : person.openalexId ? (
                          <a href={person.openalexId.startsWith("http") ? person.openalexId : `https://openalex.org/${person.openalexId}`}>OpenAlex <span aria-hidden="true">↗</span></a>
                        ) : <span className="muted">Name only</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-ranking">
            <p>No people could be ranked from the matched records.</p>
          </div>
        )}
      </div>

      <div className="audit-panel">
        <div className="panel-heading">
          <div>
            <p className="step-label">Resolution audit</p>
            <h3>{unresolved.length} {unresolved.length === 1 ? "record needs" : "records need"} review</h3>
          </div>
          <div className="audit-totals" role="group" aria-label="Resolution counts">
            <span><i className="dot dot-matched" aria-hidden="true" />{summary.matchedReferences} matched</span>
            <span><i className="dot dot-ambiguous" aria-hidden="true" />{summary.ambiguousReferences} ambiguous</span>
            <span><i className="dot dot-unmatched" aria-hidden="true" />{summary.unmatchedReferences + summary.erroredReferences} unresolved</span>
          </div>
        </div>

        {unresolved.length ? (
          <div className="audit-list">
            {unresolved.map((resolution) => (
              <details key={resolution.reference.index}>
                <summary>
                  <span className={`status status-${resolution.status}`}>{formatStatus(resolution.status)}</span>
                  <span className="reference-preview">
                    <strong>Reference {resolution.reference.index}</strong>
                    <span>{resolution.reference.raw}</span>
                  </span>
                  <span className="disclosure" aria-hidden="true">+</span>
                </summary>
                <div className="audit-detail">
                  <div>
                    <span>Reason</span>
                    <p>{resolution.reason ?? "No accepted metadata match was found."}</p>
                  </div>
                  <div>
                    <span>Confidence</span>
                    <p>{Math.round(resolution.confidence * 100)}%</p>
                  </div>
                  {resolution.alternatives.length > 0 && (
                    <div className="alternatives">
                      <span>Closest candidates</span>
                      <ol>
                        {resolution.alternatives.map((candidate) => (
                          <li key={candidate.work.id}>
                            <span>{candidate.work.title}</span>
                            <strong>{Math.round(candidate.score * 100)}%</strong>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {resolution.providerErrors.length > 0 && (
                    <div className="alternatives">
                      <span>Provider notes</span>
                      {resolution.providerErrors.map((providerError) => <p key={providerError}>{providerError}</p>)}
                    </div>
                  )}
                </div>
              </details>
            ))}
          </div>
        ) : (
          <div className="audit-clear">
            <span aria-hidden="true">✓</span>
            <p><strong>Nothing needs review.</strong> Every parsed reference received a confident match.</p>
          </div>
        )}
      </div>
    </section>
  );
}

export default App;
