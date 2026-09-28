import { BookmarkPlus, BusFront, LoaderCircle, RefreshCw, Search, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { getArrivals, searchRoutes, searchStops, type ArrivalsResponse, type Route, type Stop } from "./api";
import { addSavedRoute, loadSavedRoutes, removeSavedRoute, savedRoutesKey } from "./saved-routes";

function routeLabel(route: Route): string {
  return [route.shortName, route.longName].filter(Boolean).join(" · ") || route.routeId;
}

function minutesUntil(timestamp: string): number {
  return Math.max(0, Math.ceil((Date.parse(timestamp) - Date.now()) / 60_000));
}

function formattedTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(timestamp));
}

export function Showcase() {
  const [stopQuery, setStopQuery] = useState("");
  const [routeQuery, setRouteQuery] = useState("");
  const [stops, setStops] = useState<Stop[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [stop, setStop] = useState<Stop | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [arrivals, setArrivals] = useState<ArrivalsResponse | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [savedRoutes, setSavedRoutes] = useState<Route[]>(() => loadSavedRoutes());
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (stop || stopQuery.trim().length < 2) { setStops([]); return; }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void searchStops(stopQuery, controller.signal).then(setStops).catch((error: unknown) => {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Stop search is unavailable.");
      });
    }, 250);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [stopQuery, stop]);

  useEffect(() => {
    if (route || routeQuery.trim().length < 1) { setRoutes([]); return; }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void searchRoutes(routeQuery, controller.signal).then(setRoutes).catch(() => undefined);
    }, 250);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [routeQuery, route]);

  function persistSavedRoutes(next: Route[]) {
    try {
      window.localStorage.setItem(savedRoutesKey, JSON.stringify(next));
      setSavedRoutes(next);
      setSaveMessage(null);
    } catch {
      setSaveMessage("This browser could not save routes.");
    }
  }

  function selectRoute(candidate: Route) {
    setRoute(candidate);
    setRouteQuery(routeLabel(candidate));
    setRoutes([]);
    setArrivals(null);
    setState("idle");
  }

  async function refresh(event?: FormEvent) {
    event?.preventDefault();
    if (!stop) { setMessage("Choose a stop from the search results first."); setState("error"); return; }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState("loading");
    setMessage(null);
    try {
      const result = await getArrivals(stop.stopId, route?.routeId, controller.signal);
      setArrivals(result);
      setState("ready");
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        setMessage(error instanceof Error ? error.message : "Live arrivals are unavailable.");
        setState("error");
      }
    }
  }

  return (
    <section className="showcase" aria-labelledby="showcase-title">
      <div className="showcase__heading">
        <div>
          <span className="eyebrow">Live lookup</span>
          <h2 id="showcase-title">Next arrivals</h2>
          <p>One example of a tool you can build with the same route, stop, and arrival data.</p>
        </div>
      </div>

      <form onSubmit={(event) => void refresh(event)} className="arrival-form">
        <div className="search-field">
          <label htmlFor="stop-search">Stop</label>
          <div className="input-frame"><Search size={15} aria-hidden="true" /><input id="stop-search" value={stopQuery} onChange={(event) => { setStopQuery(event.target.value); setStop(null); setArrivals(null); }} placeholder="Search a stop name or code" autoComplete="off" /></div>
          {stops.length > 0 && <div className="suggestions" role="listbox" aria-label="Matching stops">
            {stops.map((candidate) => <button type="button" role="option" key={candidate.stopId} onClick={() => { setStop(candidate); setStopQuery(candidate.name); setStops([]); }}><strong>{candidate.name}</strong><span>{candidate.stopCode ? `Stop ${candidate.stopCode}` : candidate.stopId}</span></button>)}
          </div>}
        </div>
        <div className="search-field route-search">
          <label htmlFor="route-search">Route <span>optional</span></label>
          <div className="input-frame"><BusFront size={15} aria-hidden="true" /><input id="route-search" value={routeQuery} onChange={(event) => { setRouteQuery(event.target.value); setRoute(null); setArrivals(null); }} placeholder="82 or Westheimer" autoComplete="off" /></div>
          {routes.length > 0 && <div className="suggestions" role="listbox" aria-label="Matching routes">
            {routes.map((candidate) => <button type="button" role="option" key={candidate.routeId} onClick={() => selectRoute(candidate)}><strong>{routeLabel(candidate)}</strong><span>{candidate.routeType === 3 ? "Bus" : "Rail"}</span></button>)}
          </div>}
        </div>
        <button className="refresh-button" type="submit" disabled={state === "loading"}>
          {state === "loading" ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
          {arrivals ? "Update arrivals" : "Look up arrivals"}
        </button>
      </form>

      {(route || savedRoutes.length > 0) && <div className="saved-routes" aria-label="Saved routes">
        <div className="saved-routes__heading"><span>Saved routes</span>{route && !savedRoutes.some((saved) => saved.routeId === route.routeId) && <button type="button" onClick={() => persistSavedRoutes(addSavedRoute(savedRoutes, route))}><BookmarkPlus size={15} aria-hidden="true" /> Save {route.shortName ?? "route"}</button>}</div>
        {savedRoutes.length > 0 && <div className="saved-routes__list">{savedRoutes.map((saved) => <div className="saved-route" key={saved.routeId}><button type="button" onClick={() => selectRoute(saved)} aria-label={`Select saved route ${routeLabel(saved)}`}>{routeLabel(saved)}</button><button type="button" onClick={() => persistSavedRoutes(removeSavedRoute(savedRoutes, saved.routeId))} aria-label={`Remove saved route ${routeLabel(saved)}`}><X size={14} aria-hidden="true" /></button></div>)}</div>}
        {saveMessage && <p role="status">{saveMessage}</p>}
      </div>}

      <div className="arrival-board" aria-live="polite" aria-busy={state === "loading"}>
        {state === "error" && message ? <div className="board-message board-message--error"><TriangleAlert size={18} /><span>{message}</span></div>
          : state === "loading" ? <div className="board-message"><LoaderCircle className="spin" size={18} /><span>Reading the latest GTFS Realtime feed…</span></div>
          : !arrivals ? <div className="board-message"><BusFront size={18} /><span>Choose a stop to see upcoming arrivals.</span></div>
          : arrivals.arrivals.length === 0 ? <div className="board-message"><BusFront size={18} /><span>{route?.routeType === 0 ? <>This feed has no rail predictions. See <a href="https://www.ridemetro.org/riding-metro/transit-services/metrorail" target="_blank" rel="noreferrer">METRO's rail information</a> for other options.</> : "No upcoming predictions are currently reported for this selection."}</span></div>
          : <>
              <div className="board-header"><span>Route</span><span>Due</span><span>Time</span></div>
              <div className="board-rows">
                {arrivals.arrivals.map((arrival, index) => <div className="board-row" key={`${arrival.tripId ?? "trip"}-${arrival.predictedAt}-${index}`}>
                  <strong>{arrival.routeId ?? "METRO"}</strong><span>{minutesUntil(arrival.predictedAt)} min</span><time dateTime={arrival.predictedAt}>{formattedTime(arrival.predictedAt)}</time>
                </div>)}
              </div>
              <div className="board-footer"><span>{arrivals.source.isStale ? "Feed may be stale" : "Official live prediction"}</span><span>Updated {formattedTime(arrivals.source.feedTimestamp ?? arrivals.source.retrievedAt)}</span></div>
            </>}
      </div>
    </section>
  );
}
