import { describe, expect, it } from "vitest";
import { GET as gamesGET } from "../../app/api/games/route";
import { GET as playersGET } from "../../app/api/players/route";

describe("phase 9 app surface", () => {
  it("returns stable structured JSON for games", async () => {
    const response = await gamesGET();
    const payload = await response.json() as {
      readonly source: string;
      readonly games: readonly {
        readonly deterministic: {
          readonly derived_from: string;
        };
        readonly simulation: {
          readonly derived_from: string;
        } | null;
        readonly market: {
          readonly derived_from: string;
        } | null;
        readonly blocked: {
          readonly is_blocked: boolean;
        };
      }[];
      readonly blocked: {
        readonly games_blocked: number;
        readonly players_blocked: number;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.source).toBe("local-fixture");
    expect(payload.games.length).toBeGreaterThan(0);
    expect(payload.games[0]?.deterministic.derived_from).toBe("deterministic");
    expect(payload.games[0]?.simulation?.derived_from).toBe("simulation");
    expect(typeof payload.blocked.games_blocked).toBe("number");
    expect(typeof payload.blocked.players_blocked).toBe("number");
  });

  it("returns stable structured JSON for players", async () => {
    const response = await playersGET();
    const payload = await response.json() as {
      readonly source: string;
      readonly players: Record<
        string,
        readonly {
          readonly player_id: string;
          readonly team_id: string;
          readonly game_id: string;
          readonly fantasy_summary: {
            readonly projected_points: number;
          } | null;
          readonly simulation_summary: {
            readonly derived_from: string;
          } | null;
          readonly blocked: {
            readonly is_blocked: boolean;
          };
        }[]
      >;
      readonly blocked: {
        readonly games_blocked: number;
        readonly players_blocked: number;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.source).toBe("local-fixture");

    const groups = Object.values(payload.players);
    expect(groups.length).toBeGreaterThan(0);

    const firstGroup = groups[0];
    const firstPlayer = firstGroup?.[0];

    expect(firstPlayer).toBeDefined();

    if (!firstPlayer) {
      throw new Error("Expected at least one player payload");
    }

    expect(firstPlayer.player_id).toBeTruthy();
    expect(firstPlayer.team_id).toBeTruthy();
    expect(firstPlayer.game_id).toBeTruthy();
    expect(firstPlayer.fantasy_summary?.projected_points).toBeGreaterThan(0);
    expect(firstPlayer.simulation_summary?.derived_from).toBe("simulation");
    expect(typeof payload.blocked.games_blocked).toBe("number");
    expect(typeof payload.blocked.players_blocked).toBe("number");
  });
});
