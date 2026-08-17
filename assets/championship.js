(() => {
    "use strict";

    const championships = {
        rally: { dataUrl: "data/championship.json" },
        f4: { dataUrl: "data/championship-f4.json" }
    };
    const requestedChampionship = new URLSearchParams(window.location.search).get("champ");
    const championshipKey = Object.hasOwn(championships, requestedChampionship)
        ? requestedChampionship
        : "rally";
    const dataUrl = championships[championshipKey].dataUrl;

    document.querySelectorAll("[data-championship]").forEach((link) => {
        if (link.dataset.championship === championshipKey) {
            link.setAttribute("aria-current", "true");
        } else {
            link.removeAttribute("aria-current");
        }
    });
    const text = (value, fallback = "—") => {
        if (value === null || value === undefined || value === "") return fallback;
        return String(value);
    };

    const formatNumber = (value) => new Intl.NumberFormat("en-GB", {
        maximumFractionDigits: 1
    }).format(value);

    const formatDate = (value, timeZone) => {
        if (!value) return "Date unavailable";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "Date unavailable";
        return new Intl.DateTimeFormat("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
            timeZone
        }).format(date);
    };

    const formatRange = (start, end, timeZone) => {
        if (!start || !end) return "Dates unavailable";
        return formatDate(start, timeZone) + " – " + formatDate(end, timeZone);
    };

    const formatTime = (milliseconds) => {
        if (!Number.isFinite(milliseconds)) return "Time unavailable";
        const minutes = Math.floor(milliseconds / 60000);
        const seconds = Math.floor((milliseconds % 60000) / 1000);
        const millis = Math.floor(milliseconds % 1000);
        return minutes + ":" + String(seconds).padStart(2, "0") + "." + String(millis).padStart(3, "0");
    };

    const element = (tag, className, content) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (content !== undefined) node.textContent = content;
        return node;
    };

    const addLink = (parent, label, href, className = "text-link") => {
        if (!href) return;
        const link = element("a", className, label);
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener";
        parent.append(link);
    };

    function metric(label, value, note) {
        const card = element("article", "metric-card");
        card.append(element("span", "", label));
        card.append(element("strong", "", value));
        if (note) card.append(element("em", "", note));
        return card;
    }

    function renderOverview(data) {
        const championship = data.championship;
        const leader = championship.currentLeader;
        const upcoming = championship.upcomingRound;
        const last = championship.lastCompletedEvent;
        const grid = document.getElementById("overview-grid");

        grid.replaceChildren(
            metric("Championship", text(championship.name), "Ethiopian sim racing series"),
            metric("Season", text(championship.season), text(championship.timezone)),
            metric("Rounds", text(championship.totalRounds), "Total scheduled rounds"),
            metric("Completed", text(championship.completedRounds), last ? "Last: R" + last.round + " · " + last.name : "No completed round"),
            metric("Current leader", leader ? leader.driver : "Not available", leader ? formatNumber(leader.points) + " points" : null),
            metric("Upcoming round", upcoming ? "R" + upcoming.round + " · " + upcoming.name : "Season complete", upcoming ? formatDate(upcoming.date, championship.timezone) : null)
        );
    }

    function renderLatestResult(data) {
        const target = document.getElementById("latest-result");
        const result = data.latestResult;
        const timezone = data.championship.timezone;
        target.replaceChildren(element("span", "panel-label", "Latest result"));

        if (!result) {
            target.append(element("h3", "", "No completed result yet."));
            return;
        }

        target.append(element("h3", "", "R" + result.round + " · " + result.eventName));
        target.append(element("p", "", formatDate(result.date, timezone) + " · " + text(result.track)));

        const podium = element("ol", "podium-list");
        result.podium.forEach((entry) => {
            const row = element("li");
            row.append(element("b", "", text(entry.position)));
            row.append(element("span", "", entry.driver + (entry.country ? " · " + entry.country : "")));
            row.append(element("time", "", formatTime(entry.timeMs)));
            podium.append(row);
        });
        target.append(podium);
        addLink(target, "View complete official result", result.resultUrl);
    }

    function renderUpcoming(data) {
        const target = document.getElementById("upcoming-event");
        const event = data.upcomingEvent;
        const timezone = data.championship.timezone;
        target.replaceChildren(element(
            "span",
            "panel-label",
            event && event.status === "live" ? "Live now" : "Upcoming event"
        ));

        if (!event) {
            target.append(element("h3", "", "Season schedule complete."));
            addLink(target, "Open official championship", data.source.publicUrl);
            return;
        }

        target.append(element("h3", "", "R" + event.round + " · " + event.name));
        target.append(element("p", "", text(event.track) + (event.country ? " · " + event.country : "")));
        target.append(element("p", "", "Practice: " + formatRange(event.practiceStart, event.practiceEnd, timezone)));
        target.append(element("p", "", "Time Attack: " + formatRange(event.startDate, event.endDate, timezone)));
        if (event.car) target.append(element("p", "", "Car: " + event.car));
        addLink(target, "Open official schedule", data.source.publicUrl);
    }

    function renderStandings(data) {
        const body = document.getElementById("standings-body");
        body.replaceChildren();

        if (!data.standings.length) {
            const row = element("tr", "error-row");
            const cell = element("td", "", "Standings will appear after the first classified round.");
            cell.colSpan = 7;
            row.append(cell);
            body.append(row);
            return;
        }

        data.standings.forEach((standing) => {
            const row = element("tr");
            const rankCell = element("td");
            rankCell.dataset.label = "Position";
            rankCell.append(element(
                "span",
                "rank-badge" + (standing.position <= 3 ? " top-three" : ""),
                text(standing.position)
            ));

            const driverCell = element("td");
            driverCell.dataset.label = "Driver";
            driverCell.append(element("span", "driver-name", standing.driver));
            if (standing.racingNumber !== null) {
                driverCell.append(element("span", "driver-number", "Car #" + standing.racingNumber));
            }

            const values = [
                ["Country", text(standing.country)],
                ["Points", formatNumber(standing.points), "points-value"],
                ["Wins", text(standing.wins)],
                ["Podiums", text(standing.podiums)],
                ["Starts", text(standing.eventsEntered)]
            ];

            row.append(rankCell, driverCell);
            values.forEach(([label, value, className]) => {
                const cell = element("td", className || "", value);
                cell.dataset.label = label;
                row.append(cell);
            });
            body.append(row);
        });
    }

    function addMeta(list, label, value) {
        if (!value) return;
        const item = element("li");
        item.append(element("strong", "", label));
        item.append(element("span", "", value));
        list.append(item);
    }

    function renderSchedule(data) {
        const grid = document.getElementById("schedule-grid");
        const timezone = data.championship.timezone;
        grid.replaceChildren();

        data.events.forEach((event) => {
            const card = element("article", "event-card");
            const head = element("div", "event-head");
            const title = element("div");
            title.append(element("span", "round-label", "Round " + event.round));
            title.append(element("h3", "", event.name));
            const status = element("span", "status status-" + event.status, event.status);
            head.append(title, status);
            card.append(head);

            const meta = element("ul", "event-meta");
            addMeta(meta, "Track", text(event.track) + (event.country ? " · " + event.country : ""));
            addMeta(meta, "Practice", formatRange(event.practiceStart, event.practiceEnd, timezone));
            addMeta(meta, "Time Attack", formatRange(event.startDate, event.endDate, timezone));
            addMeta(meta, "Surface", text(event.surface));
            addMeta(meta, "Car", text(event.car));
            if (event.pointsMultiplier !== 1) addMeta(meta, "Points", event.pointsMultiplier + "× multiplier");
            card.append(meta);

            if (event.resultUrl) addLink(card, "Open official result", event.resultUrl);
            grid.append(card);
        });
    }

    function renderSource(data) {
        document.getElementById("last-updated").textContent =
            "Schedule, standings and results";

        ["official-source-top", "official-source-bottom"].forEach((id) => {
            document.getElementById(id).href = data.source.publicUrl;
        });
        document.getElementById("official-source-top").textContent = data.championship.name;
        document.title = data.championship.name + " | ETSA Live Championship";
    }

    function showFailure(error) {
        console.error(error);
        document.getElementById("last-updated").textContent =
            "Verified snapshot is temporarily unavailable. Use the official source link.";
        const body = document.getElementById("standings-body");
        const row = element("tr", "error-row");
        const cell = element("td", "", "Championship data could not be displayed. The ETSA website remains available.");
        cell.colSpan = 7;
        row.append(cell);
        body.replaceChildren(row);
    }

    fetch(dataUrl, { cache: "no-cache" })
        .then((response) => {
            if (!response.ok) throw new Error("Championship snapshot request failed: " + response.status);
            return response.json();
        })
        .then((data) => {
            renderSource(data);
            renderOverview(data);
            renderLatestResult(data);
            renderUpcoming(data);
            renderStandings(data);
            renderSchedule(data);
        })
        .catch(showFailure);
})();
