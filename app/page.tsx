import preparedFixture from "../data/fixtures/sample-prepared-game.json";
import invalidPreparedFixture from "../data/fixtures/sample-prepared-game-invalid.json";
import type { PreparedGameInputs } from "@lib/contracts/prepared";
import { buildGameCard, buildSlateView } from "@lib/services";

const prepared = preparedFixture as unknown as PreparedGameInputs;
const invalidPrepared = invalidPreparedFixture as unknown as PreparedGameInputs;

const slate = buildSlateView([prepared], {
  simulation: {
    seed: 20260328,
    iterations: 250
  },
  market_by_game_id: {
    [prepared.game_id]: {
      moneyline: {
        away_odds: 110,
        home_odds: -110
      },
      total: {
        line: 8.5,
        over_odds: -110,
        under_odds: -110
      }
    }
  }
});

const blockedGame = buildGameCard(invalidPrepared, {
  simulation: {
    seed: 99,
    iterations: 100
  }
});

const games = slate.games;
const players = [...slate.players].sort(
  (left, right) =>
    (right.fantasy_summary?.projected_points ?? -1) -
    (left.fantasy_summary?.projected_points ?? -1)
);

const featuredGame = games[0] ?? null;

const formatProbability = (value: number | null): string =>
  value === null ? "—" : `${(value * 100).toFixed(1)}%`;

const formatNumber = (value: number | null, digits = 2): string =>
  value === null ? "—" : value.toFixed(digits);

const formatSigned = (value: number | null | undefined): string => {
  if (value === null || value === undefined) {
    return "—";
  }

  return value > 0 ? `+${value}` : `${value}`;
};

const formatRange = (floor: number | null, ceiling: number | null): string => {
  if (floor === null || ceiling === null) {
    return "—";
  }

  return `${floor.toFixed(2)} → ${ceiling.toFixed(2)}`;
};

const edgeTone = (value: number | null | undefined): string => {
  if (value === null || value === undefined) {
    return "—";
  }

  if (value > 0.02) {
    return "Positive";
  }

  if (value < -0.02) {
    return "Negative";
  }

  return "Near even";
};

export default function Home() {
  return (
    <main className="page-shell">
      <header className="hero">
        <div className="eyebrow">Southern Smokey Studio</div>
        <h1 className="hero-title">Truth-first MLB dashboard.</h1>
        <div className="accent-line" />
        <p className="hero-copy">
          Engine output first. Deterministic baseline, simulation-derived uncertainty,
          and market-derived comparison stay separate on purpose. No fake certainty.
          No sportsbook theater. No template garbage.
        </p>
        <div className="hero-strip">
          <span className="badge orange">Phase 10 visual layer</span>
          <span className="badge">Verified through Phase 9</span>
          <span className="badge blue">Dark mode first</span>
        </div>
      </header>

      <nav className="nav-tabs" aria-label="Primary dashboard sections">
        <a className="nav-tab" href="#home">Home</a>
        <a className="nav-tab" href="#games">Game Projections</a>
        <a className="nav-tab" href="#players">Player Projections</a>
        <a className="nav-tab" href="#edge">Betting Edge</a>
      </nav>

      <section className="section" id="home">
        <div className="section-heading">
          <div>
            <h2>Home</h2>
            <p>Schedule surface, featured slate context, and current coverage truth.</p>
          </div>
          <span className="badge">Slate health visible</span>
        </div>

        <div className="stats-grid" style={{ marginBottom: "16px" }}>
          <article className="surface surface-pad metric-card">
            <span className="badge orange">Games</span>
            <div className="metric-value">{slate.games.length}</div>
            <div className="metric-label">Current slate game surfaces returned by the service layer.</div>
          </article>

          <article className="surface surface-pad metric-card">
            <span className="badge blue">Players</span>
            <div className="metric-value">{slate.players.length}</div>
            <div className="metric-label">Player surfaces grouped from deterministic, fantasy, and simulation layers.</div>
          </article>

          <article className="surface surface-pad metric-card">
            <span className="badge">Blocked games</span>
            <div className="metric-value">{slate.blocked.games_blocked}</div>
            <div className="metric-label">Blocked in → blocked out. Missing inputs stay visible.</div>
          </article>

          <article className="surface surface-pad metric-card">
            <span className="badge">Trust split</span>
            <div className="metric-value">3 layers</div>
            <div className="metric-label">Deterministic, simulation-derived, and market-derived remain separate.</div>
          </article>
        </div>

        <div className="home-grid">
          <article className="surface surface-pad">
            <div className="section-heading">
              <div>
                <h2>Featured slate</h2>
                <p>Clean game schedule view with baseline output, distribution signal, and blocked honesty.</p>
              </div>
              <span className={`badge ${featuredGame?.blocked.is_blocked ? "blocked" : "orange"}`}>
                {featuredGame?.blocked.is_blocked ? "Blocked" : "Live slate"}
              </span>
            </div>

            <div className="schedule-list">
              {games.map((game) => (
                <article className="schedule-card" key={game.game_id}>
                  <div className="schedule-top">
                    <div>
                      <h3 className="schedule-title">
                        {game.away_team_id.toUpperCase()} at {game.home_team_id.toUpperCase()}
                      </h3>
                      <div className="schedule-meta">{game.game_id}</div>
                    </div>
                    <span className={`badge ${game.blocked.is_blocked ? "blocked" : "blue"}`}>
                      {game.blocked.is_blocked ? "Blocked" : "Ready"}
                    </span>
                  </div>

                  <div className="info-grid">
                    <div className="info-row">
                      <div className="info-k">Projected total</div>
                      <div className="info-v">{formatNumber(game.deterministic.projected_total)}</div>
                    </div>
                    <div className="info-row">
                      <div className="info-k">Away win</div>
                      <div className="info-v">{formatProbability(game.simulation?.away_win_probability ?? null)}</div>
                    </div>
                    <div className="info-row">
                      <div className="info-k">Home win</div>
                      <div className="info-v">{formatProbability(game.simulation?.home_win_probability ?? null)}</div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </article>

          <aside className="surface surface-pad">
            <div className="section-heading">
              <div>
                <h2>Coverage notes</h2>
                <p>What the user can trust, what is distribution-only, and what is just market comparison.</p>
              </div>
              <span className="badge">Rules</span>
            </div>

            <div className="rule-list">
              <div className="rule-item">
                <span className="rule-label">Baseline first</span>
                <div className="copy">
                  Deterministic output is the clean first read. It tells you what the engine projects before simulation
                  or market framing get involved.
                </div>
              </div>
              <div className="rule-item">
                <span className="rule-label">Uncertainty stays visible</span>
                <div className="copy">
                  Simulation adds distribution. It does not turn uncertainty into fake precision.
                </div>
              </div>
              <div className="rule-item">
                <span className="rule-label">Market is comparison only</span>
                <div className="copy">
                  Market-derived output compares model probability to line-implied probability. It is not a recommendation engine.
                </div>
              </div>
              <div className="rule-item">
                <span className="rule-label">Blocked means blocked</span>
                <div className="copy">
                  Missing or invalid upstream inputs remain visible. They do not get polished over in the UI.
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="section" id="games">
        <div className="section-heading">
          <div>
            <h2>Game Projections</h2>
            <p>Game-level projection surface with clean separation between baseline, distribution, and market comparison.</p>
          </div>
          <span className="badge blue">Game card view</span>
        </div>

        {featuredGame ? (
          <div className="games-grid">
            <article className="surface surface-pad">
              <div className="section-heading">
                <div>
                  <h2>{featuredGame.away_team_id.toUpperCase()} at {featuredGame.home_team_id.toUpperCase()}</h2>
                  <p>{featuredGame.game_id}</p>
                </div>
                <span className={`badge ${featuredGame.blocked.is_blocked ? "blocked" : "orange"}`}>
                  {featuredGame.blocked.is_blocked ? "Blocked" : "Featured"}
                </span>
              </div>

              <div className="stack">
                <section className="segment">
                  <div className="segment-title">
                    <h3>Deterministic output</h3>
                    <span className="badge">Baseline</span>
                  </div>
                  <div className="info-grid">
                    <div className="info-row">
                      <div className="info-k">Away runs</div>
                      <div className="info-v">{formatNumber(featuredGame.deterministic.projected_away_runs)}</div>
                    </div>
                    <div className="info-row">
                      <div className="info-k">Home runs</div>
                      <div className="info-v">{formatNumber(featuredGame.deterministic.projected_home_runs)}</div>
                    </div>
                    <div className="info-row">
                      <div className="info-k">Projected total</div>
                      <div className="info-v">{formatNumber(featuredGame.deterministic.projected_total)}</div>
                    </div>
                  </div>
                  <p className="copy">
                    Baseline read only. No simulation fields mixed into the projection line itself.
                  </p>
                </section>

                <section className="segment">
                  <div className="segment-title">
                    <h3>Simulation-derived</h3>
                    <span className="badge blue">Distribution</span>
                  </div>
                  {featuredGame.simulation ? (
                    <>
                      <div className="info-grid">
                        <div className="info-row">
                          <div className="info-k">Away win</div>
                          <div className="info-v">{formatProbability(featuredGame.simulation.away_win_probability)}</div>
                        </div>
                        <div className="info-row">
                          <div className="info-k">Home win</div>
                          <div className="info-v">{formatProbability(featuredGame.simulation.home_win_probability)}</div>
                        </div>
                        <div className="info-row">
                          <div className="info-k">Avg away runs</div>
                          <div className="info-v">{formatNumber(featuredGame.simulation.average_away_runs)}</div>
                        </div>
                        <div className="info-row">
                          <div className="info-k">Avg home runs</div>
                          <div className="info-v">{formatNumber(featuredGame.simulation.average_home_runs)}</div>
                        </div>
                        <div className="info-row">
                          <div className="info-k">Avg total</div>
                          <div className="info-v">{formatNumber(featuredGame.simulation.average_total_runs)}</div>
                        </div>
                      </div>
                      <p className="copy">
                        Simulation sharpens the range view. It is still uncertainty, not gospel.
                      </p>
                    </>
                  ) : (
                    <div className="blocked-box">Simulation surface unavailable for this game.</div>
                  )}
                </section>

                <section className="segment">
                  <div className="segment-title">
                    <h3>Blocked / incomplete state</h3>
                    <span className="badge blocked">Honest state</span>
                  </div>
                  <div className="blocked-box">
                    <strong>{blockedGame.game_id}</strong>
                    <div style={{ height: "8px" }} />
                    {blockedGame.blocked.blocked_reason ?? "Blocked game surface."}
                  </div>
                </section>
              </div>
            </article>
          </div>
        ) : (
          <div className="blocked-box">No featured game was returned by the current slate service.</div>
        )}
      </section>

      <section className="section" id="players">
        <div className="section-heading">
          <div>
            <h2>Player Projections</h2>
            <p>Cleaner comparison path for player stats, DK fantasy points, and simulation-derived ranges.</p>
          </div>
          <span className="badge orange">Row-first surface</span>
        </div>

        <article className="surface surface-pad">
          <div className="player-table-wrap">
            <table className="player-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Baseline</th>
                  <th>DK fantasy</th>
                  <th>Simulation mean</th>
                  <th>Simulation range</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {players.map((player) => (
                  <tr key={player.player_id}>
                    <td>
                      <div className="player-name">{player.player_id}</div>
                      <div className="player-meta">
                        {player.team_id.toUpperCase()} · {player.game_id}
                      </div>
                    </td>
                    <td>
                      {player.deterministic_summary ? (
                        player.deterministic_summary.kind === "pitcher" ? (
                          <div className="copy">
                            IP {formatNumber(player.deterministic_summary.projected_ip)} · K {formatNumber(player.deterministic_summary.projected_k)}
                          </div>
                        ) : (
                          <div className="copy">
                            Hits {formatNumber(player.deterministic_summary.projected_hits)} · HR {formatNumber(player.deterministic_summary.projected_hr)} · Runs {formatNumber(player.deterministic_summary.projected_runs)}
                          </div>
                        )
                      ) : (
                        <div className="copy">—</div>
                      )}
                    </td>
                    <td>
                      <div className="copy">{formatNumber(player.fantasy_summary?.projected_points ?? null)}</div>
                    </td>
                    <td>
                      <div className="copy">{formatNumber(player.simulation_summary?.mean_points ?? null)}</div>
                    </td>
                    <td>
                      <div className="copy">
                        {formatRange(
                          player.simulation_summary?.simulated_floor ?? null,
                          player.simulation_summary?.simulated_ceiling ?? null
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`player-status ${player.blocked.is_blocked ? "blocked" : "active"}`}>
                        {player.blocked.is_blocked ? "Blocked" : "Active"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="section" id="edge">
        <div className="section-heading">
          <div>
            <h2>Betting Edge</h2>
            <p>Market odds and lines versus model probabilities. Comparison only. No casino energy.</p>
          </div>
          <span className="badge orange">Market-derived</span>
        </div>

        {featuredGame?.market ? (
          <div className="edge-grid">
            <article className="surface surface-pad">
              <div className="segment-title">
                <h3>Moneyline · away</h3>
                <span className="badge">Comparison</span>
              </div>
              <div className="info-grid">
                <div className="info-row">
                  <div className="info-k">Model probability</div>
                  <div className="info-v">{formatProbability(featuredGame.market.moneyline?.away.model_probability ?? null)}</div>
                </div>
                <div className="info-row">
                  <div className="info-k">Market implied</div>
                  <div className="info-v">{formatProbability(featuredGame.market.moneyline?.away.market_implied_probability ?? null)}</div>
                </div>
                <div className="info-row">
                  <div className="info-k">Fair odds</div>
                  <div className="info-v">{formatSigned(featuredGame.market.moneyline?.away.fair_american_odds)}</div>
                </div>
                <div className="info-row">
                  <div className="info-k">Raw edge</div>
                  <div className="info-v">
                    {formatProbability(featuredGame.market.moneyline?.away.raw_edge ?? null)} · {edgeTone(featuredGame.market.moneyline?.away.raw_edge)}
                  </div>
                </div>
              </div>
            </article>

            <article className="surface surface-pad">
              <div className="segment-title">
                <h3>Moneyline · home</h3>
                <span className="badge">Comparison</span>
              </div>
              <div className="info-grid">
                <div className="info-row">
                  <div className="info-k">Model probability</div>
                  <div className="info-v">{formatProbability(featuredGame.market.moneyline?.home.model_probability ?? null)}</div>
                </div>
                <div className="info-row">
                  <div className="info-k">Market implied</div>
                  <div className="info-v">{formatProbability(featuredGame.market.moneyline?.home.market_implied_probability ?? null)}</div>
                </div>
                <div className="info-row">
                  <div className="info-k">Fair odds</div>
                  <div className="info-v">{formatSigned(featuredGame.market.moneyline?.home.fair_american_odds)}</div>
                </div>
                <div className="info-row">
                  <div className="info-k">Raw edge</div>
                  <div className="info-v">
                    {formatProbability(featuredGame.market.moneyline?.home.raw_edge ?? null)} · {edgeTone(featuredGame.market.moneyline?.home.raw_edge)}
                  </div>
                </div>
              </div>
            </article>

            <article className="surface surface-pad">
              <div className="segment-title">
                <h3>Total · over</h3>
                <span className="badge blue">Totals</span>
              </div>
              <div className="info-grid">
                <div className="info-row">
                  <div className="info-k">Line</div>
                  <div className="info-v">{formatNumber(featuredGame.market.total?.over.line ?? null, 1)}</div>
                </div>
                <div className="info-row">
                  <div className="info-k">Model probability</div>
                  <div className="info-v">{formatProbability(featuredGame.market.total?.over.model_probability ?? null)}</div>
                </div>
                <div className="info-row">
                  <div className="info-k">Raw edge</div>
                  <div className="info-v">
                    {formatProbability(featuredGame.market.total?.over.raw_edge ?? null)} · {edgeTone(featuredGame.market.total?.over.raw_edge)}
                  </div>
                </div>
                <div className="info-row">
                  <div className="info-k">Push probability</div>
                  <div className="info-v">{formatProbability(featuredGame.market.total?.over.push_probability ?? null)}</div>
                </div>
              </div>
            </article>

            <article className="surface surface-pad">
              <div className="segment-title">
                <h3>Total · under</h3>
                <span className="badge blue">Totals</span>
              </div>
              <div className="info-grid">
                <div className="info-row">
                  <div className="info-k">Line</div>
                  <div className="info-v">{formatNumber(featuredGame.market.total?.under.line ?? null, 1)}</div>
                </div>
                <div className="info-row">
                  <div className="info-k">Model probability</div>
                  <div className="info-v">{formatProbability(featuredGame.market.total?.under.model_probability ?? null)}</div>
                </div>
                <div className="info-row">
                  <div className="info-k">Raw edge</div>
                  <div className="info-v">
                    {formatProbability(featuredGame.market.total?.under.raw_edge ?? null)} · {edgeTone(featuredGame.market.total?.under.raw_edge)}
                  </div>
                </div>
                <div className="info-row">
                  <div className="info-k">Push probability</div>
                  <div className="info-v">{formatProbability(featuredGame.market.total?.under.push_probability ?? null)}</div>
                </div>
              </div>
            </article>
          </div>
        ) : (
          <div className="blocked-box">No market comparison surface is attached to the featured game.</div>
        )}
      </section>
    </main>
  );
}
