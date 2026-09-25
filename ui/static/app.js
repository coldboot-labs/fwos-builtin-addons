(function () {
  var app = document.getElementById("app");

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : "";
  }

  function checked(id) {
    var el = document.getElementById(id);
    return !!(el && el.checked);
  }

  var acceptedRoutes = [];
  var workingRoutes = [];
  var acceptedRevision = 0;
  var pendingDraft = null;
  var draftReviewMode = null;
  var editingRoute = -1;
  var proposedRoutes = null;

  async function loadRoutes() {
    var list = document.getElementById("route-list");
    if (!list) return;
    try {
      var response = await fetch("/api/routes", { credentials: "same-origin" });
      var result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Routes unavailable");
      acceptedRoutes = result.routes || [];
      acceptedRevision = result.revision;
      var draftResponse = await fetch("/api/draft", { credentials: "same-origin" });
      var draft = await draftResponse.json();
      if (!draftResponse.ok || !draft.ok) throw new Error(draft.error || "Draft unavailable");
      pendingDraft = draft.status === "pending" ? draft : null;
      workingRoutes = pendingDraft ? pendingDraft.routes : acceptedRoutes;
      document.getElementById("accepted-route-status").textContent = "Accepted revision " + acceptedRevision;
      document.getElementById("accepted-route-list").innerHTML = acceptedRoutes.map(function (route) {
        return "<li>" + esc(route.to) + " via " + esc(route.via) +
          (route.dev ? " on " + esc(route.dev) : "") + "</li>";
      }).join("");
      document.getElementById("draft-status").textContent = pendingDraft
        ? "Private pending draft based on Accepted revision " + pendingDraft.base_revision +
          (pendingDraft.stale ? "; stale against current Accepted revision " + acceptedRevision : "")
        : "No private pending draft";
      document.getElementById("draft-actions").hidden = !pendingDraft;
      document.getElementById("draft-reconcile").hidden = !pendingDraft || !pendingDraft.stale;
      document.getElementById("route-apply").disabled = !!pendingDraft;
      var select = document.getElementById("route-interface");
      select.innerHTML = "<option value=\"\">Automatic</option>" +
        (result.interfaces || []).map(function (name) {
          return "<option value=\"" + esc(name) + "\">" + esc(name) + "</option>";
        }).join("");
      list.innerHTML = workingRoutes.map(function (route, index) {
        return "<li>" + esc(route.to) + " via " + esc(route.via) +
          (route.dev ? " on " + esc(route.dev) : "") +
          " <button type=\"button\" data-edit=\"" + index + "\">Edit</button>" +
          " <button type=\"button\" data-remove=\"" + index + "\">Remove</button></li>";
      }).join("");
      list.querySelectorAll("[data-edit]").forEach(function (button) {
        button.addEventListener("click", function () {
          editingRoute = Number(button.dataset.edit);
          var route = workingRoutes[editingRoute];
          document.getElementById("route-destination").value = route.to;
          document.getElementById("route-gateway").value = route.via;
          select.value = route.dev || "";
          document.getElementById("route-destination").focus();
        });
      });
      list.querySelectorAll("[data-remove]").forEach(function (button) {
        button.addEventListener("click", function () {
          var index = Number(button.dataset.remove);
          proposedRoutes = workingRoutes.filter(function (_, i) { return i !== index; });
          showRouteReview("Remove " + workingRoutes[index].to + " via " + workingRoutes[index].via);
        });
      });
    } catch (error) {
      document.getElementById("route-result").textContent = "Could not load Accepted routes: " + error.message;
    }
  }

  function showRouteReview(summary) {
    document.getElementById("route-review").hidden = false;
    document.getElementById("route-summary").textContent = summary +
      ". Review against Accepted revision " +
      (pendingDraft ? pendingDraft.base_revision : acceptedRevision);
    document.getElementById("route-result").textContent = "";
  }

  function setupRoutes() {
    loadRoutes();
    document.getElementById("route-form").addEventListener("submit", function (event) {
      event.preventDefault();
      var route = { to: val("route-destination"), via: val("route-gateway") };
      if (val("route-interface")) route.dev = val("route-interface");
      proposedRoutes = workingRoutes.slice();
      if (editingRoute >= 0) proposedRoutes[editingRoute] = route;
      else proposedRoutes.push(route);
      showRouteReview((editingRoute >= 0 ? "Change " : "Add ") + route.to + " via " + route.via +
        (route.dev ? " on " + route.dev : ""));
    });
    document.getElementById("route-save-draft").addEventListener("click", async function (event) {
      var button = event.currentTarget;
      button.disabled = true;
      try {
        var response = await fetch("/api/draft/save", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base_revision: pendingDraft ? pendingDraft.base_revision : acceptedRevision,
            version: pendingDraft ? pendingDraft.version : null,
            routes: proposedRoutes,
          }),
        });
        var result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Draft save failed");
        document.getElementById("route-review").hidden = true;
        document.getElementById("route-result").textContent =
          "Draft saved against Accepted revision " + result.base_revision + "; networking unchanged";
        await loadRoutes();
      } catch (error) {
        document.getElementById("route-result").textContent = "Draft save failed: " + error.message;
      } finally {
        button.disabled = false;
      }
    });
    document.getElementById("route-apply").addEventListener("click", async function (event) {
      var button = event.currentTarget;
      button.disabled = true;
      try {
        var response = await fetch("/api/routes/apply", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base_revision: acceptedRevision, routes: proposedRoutes }),
        });
        var result = await response.json();
        if (!response.ok || !result.ok) {
          var recovery = result.restoration === "restored"
            ? " Previous Accepted network restored."
            : result.restoration === "failed" || result.restoration === "required"
              ? " Network restoration needs recovery; check the Appliance console."
              : "";
          document.getElementById("route-result").textContent =
            (result.outcome === "rejected" ? "Rejected: " : "Apply failed: ") +
            (result.error || "Route change unavailable") + recovery;
          return;
        }
        document.getElementById("route-review").hidden = true;
        document.getElementById("route-result").textContent = "Accepted revision " + result.revision;
        document.getElementById("route-form").reset();
        editingRoute = -1;
        proposedRoutes = null;
        await loadRoutes();
      } catch (_) {
        document.getElementById("route-result").textContent = "Apply outcome unavailable; reload routes before retrying.";
      } finally {
        button.disabled = false;
      }
    });
    document.getElementById("draft-review").addEventListener("click", function () {
      if (!pendingDraft) return;
      draftReviewMode = "apply";
      document.getElementById("draft-review-heading").textContent = "Review pending draft";
      document.getElementById("draft-review-summary").textContent =
        "Private pending routes: " + pendingDraft.routes.map(function (route) {
          return route.to + " via " + route.via;
        }).join(", ") + ". Based on Accepted revision " + pendingDraft.base_revision +
        "; current Accepted revision " + acceptedRevision + ".";
      document.getElementById("draft-apply").hidden = false;
      document.getElementById("draft-reconcile-save").hidden = true;
      document.getElementById("draft-review-panel").hidden = false;
    });
    document.getElementById("draft-apply").addEventListener("click", async function (event) {
      if (!pendingDraft || draftReviewMode !== "apply") return;
      var button = event.currentTarget;
      button.disabled = true;
      try {
        var response = await fetch("/api/draft/apply", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base_revision: pendingDraft.base_revision, version: pendingDraft.version }),
        });
        var result = await response.json();
        if (!response.ok || !result.ok) {
          var recovery = result.restoration === "restored"
            ? " Previous Accepted network restored."
            : result.restoration === "failed" || result.restoration === "required"
              ? " Network restoration needs recovery; check the Appliance console."
              : "";
          document.getElementById("route-result").textContent = response.status === 409
            ? "Stale draft retained: " + (result.error || "review reconciliation")
            : "Draft apply failed; draft retained: " + (result.error || "unknown error") + recovery;
          await loadRoutes();
          return;
        }
        document.getElementById("draft-review-panel").hidden = true;
        document.getElementById("route-result").textContent = "Accepted revision " + result.revision;
        await loadRoutes();
      } catch (_) {
        document.getElementById("route-result").textContent = "Apply outcome unavailable; check Accepted revision and private draft.";
      } finally {
        button.disabled = false;
      }
    });
    document.getElementById("draft-reconcile").addEventListener("click", function () {
      if (!pendingDraft || !pendingDraft.stale) return;
      draftReviewMode = "reconcile";
      document.getElementById("draft-review-heading").textContent = "Review reconciliation";
      document.getElementById("draft-review-summary").textContent =
        "Current Accepted revision " + acceptedRevision + " routes: " +
        acceptedRoutes.map(function (route) { return route.to + " via " + route.via; }).join(", ") +
        ". Replace those routes with your private pending routes: " +
        pendingDraft.routes.map(function (route) { return route.to + " via " + route.via; }).join(", ") +
        ". Saving does not apply; review the new draft again before applying.";
      document.getElementById("draft-apply").hidden = true;
      document.getElementById("draft-reconcile-save").hidden = false;
      document.getElementById("draft-review-panel").hidden = false;
    });
    document.getElementById("draft-reconcile-save").addEventListener("click", async function (event) {
      if (!pendingDraft || draftReviewMode !== "reconcile") return;
      var button = event.currentTarget;
      button.disabled = true;
      try {
        var response = await fetch("/api/draft/reconcile", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base_revision: pendingDraft.base_revision, version: pendingDraft.version,
            accepted_revision: acceptedRevision, routes: pendingDraft.routes,
          }),
        });
        var result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "reconciliation unavailable");
        document.getElementById("draft-review-panel").hidden = true;
        document.getElementById("route-result").textContent =
          "Reconciled draft saved against Accepted revision " + result.base_revision + "; networking unchanged";
        await loadRoutes();
      } catch (error) {
        document.getElementById("route-result").textContent = "Reconciliation failed: " + error.message;
      } finally {
        button.disabled = false;
      }
    });
  }

  function renderLogin() {
    app.innerHTML =
      "<h2>Sign in</h2>" +
      "<form id=\"login\">" +
      "<label>Username <input id=\"username\" autocomplete=\"username\" required></label>" +
      "<label>Password <input id=\"password\" type=\"password\" autocomplete=\"current-password\" required></label>" +
      "<button type=\"submit\">Sign in</button>" +
      "<p id=\"login-error\" class=\"err\" role=\"alert\"></p>" +
      "</form>";
    var form = document.getElementById("login");
    form.addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var button = form.querySelector("button");
      var error = document.getElementById("login-error");
      var password = document.getElementById("password");
      button.disabled = true;
      error.textContent = "";
      var body = JSON.stringify({
        source: "local",
        username: val("username"),
        password: password.value,
      });
      password.value = "";
      try {
        var response = await fetch("/api/login", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: body,
        });
        var result = await response.json();
        if (!response.ok || !result.ok) {
          error.textContent = result.error || "login failed";
          password.focus();
          return;
        }
        await load();
      } catch (e) {
        error.textContent = "Sign in is unavailable. Please try again.";
      } finally {
        button.disabled = false;
      }
    });
  }

  function renderStatus(st) {
    var principal = st.principal || {};
    var ifaces = (st.interfaces || [])
      .map(function (i) {
        var bits = [esc(i.name)];
        if (i.role) bits.push(esc(i.role));
        if (i.vlan) bits.push("vlan " + esc(i.vlan));
        if (i.dhcp) bits.push("dhcp");
        if (i.addresses && i.addresses.length) bits.push(esc(i.addresses.join(" ")));
        return "<li>" + bits.join(" · ") + "</li>";
      })
      .join("");
    var exposure = (st.ui_exposure || []).map(esc).join(", ");
    app.innerHTML =
      "<h2>Status</h2>" +
      "<p>Signed in as " + esc(principal.username || "") +
      " (" + esc(principal.source || "") + ")</p>" +
      "<button id=\"sign-out\" type=\"button\">Sign out</button>" +
      "<p id=\"logout-error\" class=\"err\" role=\"alert\"></p>" +
      "<p>hostname: " + esc(st.hostname || "") + "</p>" +
      "<p>LAN prefix: " + esc(st.lan_prefix || "") + "</p>" +
      "<p>DHCP pool: " + esc(st.dhcp_pool || "") + "</p>" +
      "<p>WAN PD: " + esc(st.wan_pd || "") + "</p>" +
      "<p>UI exposure: " + esc(exposure) + "</p>" +
      "<p class=\"muted\">Default policy is applied automatically when a WAN exists.</p>" +
      "<h3>NICs</h3><ul>" +
      ifaces +
      "</ul>" +
      "<section><h3>Static routes</h3>" +
      "<p id=\"accepted-route-status\"></p>" +
      "<ul id=\"accepted-route-list\"></ul>" +
      "<p id=\"draft-status\"></p>" +
      "<div id=\"draft-actions\" hidden>" +
      "<button id=\"draft-review\" type=\"button\">Review pending draft</button>" +
      "<button id=\"draft-reconcile\" type=\"button\" hidden>Review reconciliation</button></div>" +
      "<div id=\"draft-review-panel\" hidden><h4 id=\"draft-review-heading\"></h4>" +
      "<p id=\"draft-review-summary\"></p>" +
      "<button id=\"draft-apply\" type=\"button\" hidden>Apply reviewed draft</button>" +
      "<button id=\"draft-reconcile-save\" type=\"button\" hidden>Save reconciled draft</button></div>" +
      "<ul id=\"route-list\"></ul>" +
      "<form id=\"route-form\">" +
      "<label>Destination <input id=\"route-destination\" required placeholder=\"198.51.100.0/24\"></label>" +
      "<label>Next hop <input id=\"route-gateway\" required placeholder=\"192.0.2.2\"></label>" +
      "<label for=\"route-interface\">Interface</label> <select id=\"route-interface\"></select>" +
      "<button type=\"submit\">Review route</button></form>" +
      "<div id=\"route-review\" hidden><h4>Review route change</h4>" +
      "<p id=\"route-summary\"></p>" +
      "<button id=\"route-save-draft\" type=\"button\">Save draft</button>" +
      "<button id=\"route-apply\" type=\"button\">Apply route change</button></div>" +
      "<p id=\"route-result\" role=\"status\"></p></section>" +
      "<section><h3>Administrators</h3>" +
      "<ul id=\"administrator-list\"></ul>" +
      "<form id=\"create-administrator\">" +
      "<label>New administrator username <input id=\"new-administrator-username\" required></label>" +
      "<label>New administrator password <input id=\"new-administrator-password\" type=\"password\" required></label>" +
      "<button type=\"submit\">Create administrator</button>" +
      "<p id=\"administrators-error\" class=\"err\" role=\"alert\"></p>" +
      "</form>" +
      "<form id=\"change-administrator-password\">" +
      "<label>Administrator to change <select id=\"change-administrator-name\"></select></label>" +
      "<label>Replacement password <input id=\"replacement-password\" type=\"password\" required></label>" +
      "<button type=\"submit\">Change password</button>" +
      "<p id=\"password-change-result\" role=\"status\"></p>" +
      "</form>" +
      "<form id=\"remove-administrator\">" +
      "<label>Administrator to remove <select id=\"remove-administrator-name\"></select></label>" +
      "<button type=\"submit\">Remove administrator</button>" +
      "<p id=\"remove-administrator-result\" role=\"status\"></p>" +
      "</form></section>";
    setupRoutes();
    loadAdministrators();
    document.getElementById("create-administrator").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var form = ev.currentTarget;
      var button = form.querySelector("button");
      var error = document.getElementById("administrators-error");
      var password = document.getElementById("new-administrator-password");
      button.disabled = true;
      error.textContent = "";
      var body = JSON.stringify({
        username: val("new-administrator-username"),
        password: password.value,
      });
      password.value = "";
      try {
        var response = await fetch("/api/administrators", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: body,
        });
        var result = await response.json();
        if (!response.ok || !result.ok) {
          error.textContent = result.error || "Could not create administrator.";
          return;
        }
        form.reset();
        await loadAdministrators();
      } catch (e) {
        error.textContent = "Account changes are unavailable. Please try again.";
      } finally {
        button.disabled = false;
      }
    });
    document.getElementById("change-administrator-password").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var form = ev.currentTarget;
      var button = form.querySelector("button");
      var resultText = document.getElementById("password-change-result");
      var password = document.getElementById("replacement-password");
      var changingSelf = principal.source === "local" &&
        val("change-administrator-name") === principal.username;
      button.disabled = true;
      resultText.textContent = "";
      var body = JSON.stringify({
        username: val("change-administrator-name"),
        password: password.value,
      });
      password.value = "";
      try {
        var response = await fetch("/api/administrators/password", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: body,
        });
        var result = await response.json();
        if (!response.ok || !result.ok) {
          resultText.textContent = result.error || "Could not change password.";
          return;
        }
        if (changingSelf) {
          renderLogin();
          return;
        }
        resultText.textContent = "Password changed";
      } catch (e) {
        resultText.textContent = "Account changes are unavailable. Please try again.";
      } finally {
        button.disabled = false;
      }
    });
    document.getElementById("remove-administrator").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var form = ev.currentTarget;
      var button = form.querySelector("button");
      var resultText = document.getElementById("remove-administrator-result");
      var username = val("remove-administrator-name");
      if (!username || !window.confirm("Remove administrator " + username + "?")) return;
      button.disabled = true;
      resultText.textContent = "";
      try {
        var response = await fetch("/api/administrators/remove", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: username }),
        });
        var result = await response.json();
        if (!response.ok || !result.ok) {
          resultText.textContent = result.error || "Could not remove administrator.";
          return;
        }
        resultText.textContent = "Administrator removed";
        await loadAdministrators();
      } catch (e) {
        resultText.textContent = "Account changes are unavailable. Please try again.";
      } finally {
        button.disabled = false;
      }
    });
    document.getElementById("sign-out").addEventListener("click", async function (ev) {
      var button = ev.currentTarget;
      var error = document.getElementById("logout-error");
      button.disabled = true;
      error.textContent = "";
      try {
        var response = await fetch("/api/logout", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (response.ok || response.status === 401) {
          renderLogin();
        } else {
          error.textContent = "Sign out failed. Please try again.";
        }
      } catch (e) {
        error.textContent = "Sign out is unavailable. Please try again.";
      } finally {
        button.disabled = false;
      }
    });
  }

  async function loadAdministrators() {
    var list = document.getElementById("administrator-list");
    if (!list) return;
    try {
      var response = await fetch("/api/administrators", { credentials: "same-origin" });
      if (response.status === 401) {
        renderLogin();
        return;
      }
      var result = await response.json();
      if (!response.ok || !result.ok) throw new Error("account list unavailable");
      list.innerHTML = (result.administrators || [])
        .map(function (username) { return "<li>" + esc(username) + "</li>"; })
        .join("");
      var changeSelect = document.getElementById("change-administrator-name");
      if (changeSelect) {
        changeSelect.innerHTML = (result.administrators || [])
          .map(function (username) { return "<option value=\"" + esc(username) + "\">" + esc(username) + "</option>"; })
          .join("");
      }
      var removeSelect = document.getElementById("remove-administrator-name");
      if (removeSelect) {
        removeSelect.innerHTML = (result.administrators || [])
          .map(function (username) { return "<option value=\"" + esc(username) + "\">" + esc(username) + "</option>"; })
          .join("");
      }
    } catch (e) {
      var error = document.getElementById("administrators-error");
      if (error) error.textContent = "Could not load administrators.";
    }
  }

  function nicOptions(nics, selected, includeNone) {
    var html = includeNone ? "<option value=\"\">none</option>" : "";
    return html + nics
      .map(function (n) {
        var sel = n.name === selected ? " selected" : "";
        return "<option value=\"" + esc(n.name) + "\"" + sel + ">" + esc(n.name) + "</option>";
      })
      .join("");
  }

  function renderWizard(st) {
    var nics = st.nics || [];
    var lanDefault = nics[0] ? nics[0].name : "";
    var wanDefault = nics[1] ? nics[1].name : lanDefault;
    var oneNic = nics.length === 1;
    app.innerHTML =
      "<h2>Bootstrap wizard</h2>" +
      "<form id=\"wiz\">" +
      "<label>hostname <input id=\"hostname\" required></label>" +
      "<label>admin <input id=\"admin\" required></label>" +
      "<label>password <input id=\"password\" type=\"password\" required></label>" +
      "<h3>WAN</h3>" +
      "<label>WAN <select id=\"wan_nic\">" +
      nicOptions(nics, wanDefault) +
      "</select></label>" +
      "<label><input type=\"checkbox\" id=\"wan_tagged\"> tagged</label>" +
      "<label>WAN VLAN <input id=\"wan_vlan\" value=\"10\"></label>" +
      "<h3>LAN</h3>" +
      "<label>LAN <select id=\"lan_nic\">" +
      nicOptions(nics, lanDefault) +
      "</select></label>" +
      "<label><input type=\"checkbox\" id=\"lan_tagged\"" +
      (oneNic ? " checked" : "") +
      "> tagged</label>" +
      "<label>LAN VLAN <input id=\"lan_vlan\" value=\"20\"></label>" +
      "<h3>Management NIC</h3>" +
      "<label>Management NIC <select id=\"mgmt_nic\">" +
      nicOptions(nics, "", true) +
      "</select></label>" +
      "<label>on-link prefix <input id=\"mgmt_prefix\" placeholder=\"no gateway\"></label>" +
      "<h3>UI exposure</h3>" +
      "<label id=\"expose_mgmt_row\" style=\"display:none\"><input type=\"checkbox\" id=\"expose_mgmt\" checked disabled> Management NIC</label>" +
      "<label><input type=\"checkbox\" id=\"expose_lan\" checked disabled> LAN <span id=\"lan_req\">(required)</span></label>" +
      "<p id=\"warn\" class=\"muted\"></p>" +
      "<label>addressing" +
      "<select id=\"addressing\">" +
      "<option value=\"static\" selected>static</option>" +
      "<option value=\"dhcp\">DHCP</option>" +
      "</select></label>" +
      "<label>WAN address <input id=\"wan_addr\" value=\"192.0.2.1/24\"></label>" +
      "<label>WAN IPv6 <input id=\"wan_addr6\"></label>" +
      "<label>WAN PD <input id=\"wan_pd\"></label>" +
      "<label>LAN prefix <input id=\"lan_prefix\" value=\"192.168.1.0/24\"></label>" +
      "<label>DHCP pool <input id=\"dhcp_pool\" value=\"192.168.1.100-192.168.1.200\"></label>" +
      "<button type=\"submit\">Bootstrap</button>" +
      "<p id=\"err\" class=\"err\"></p>" +
      "</form>";
    function refreshWarn() {
      var warn = document.getElementById("warn");
      var hasMgmt = !!val("mgmt_nic");
      var mgmtRow = document.getElementById("expose_mgmt_row");
      var lanBox = document.getElementById("expose_lan");
      var lanReq = document.getElementById("lan_req");
      if (mgmtRow) mgmtRow.style.display = hasMgmt ? "block" : "none";
      if (lanBox) {
        if (hasMgmt) {
          lanBox.disabled = false;
          if (lanReq) lanReq.textContent = "(optional)";
        } else {
          lanBox.checked = true;
          lanBox.disabled = true;
          if (lanReq) lanReq.textContent = "(required)";
        }
      }
      if (nics.length === 1 && !checked("wan_tagged") && checked("lan_tagged")) {
        warn.textContent =
          "Untagged first-boot HTTPS will vanish if the untagged L2 is not in the post-apply UI exposure set. Apply still proceeds.";
      } else {
        warn.textContent = "";
      }
    }
    ["wan_nic", "lan_nic", "wan_tagged", "lan_tagged", "mgmt_nic"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("change", refreshWarn);
    });
    refreshWarn();
    document.getElementById("wiz").addEventListener("submit", function (ev) {
      ev.preventDefault();
      submit(nics);
    });
  }

  function lanHost(prefix) {
    var ip = (prefix.split("/")[0] || "").split(".");
    if (ip.length !== 4) return "";
    if (ip[3] === "0") ip[3] = "1";
    var pfx = prefix.split("/")[1] || "24";
    return ip.join(".") + "/" + pfx;
  }

  function l2Name(nic, tagged, vid) {
    return tagged ? nic + "." + vid : nic;
  }

  async function submit(nics) {
    var err = document.getElementById("err");
    err.textContent = "";
    var addressing = val("addressing");
    var dhcp = addressing === "dhcp";
    var addrs = [];
    if (!dhcp) {
      if (val("wan_addr")) addrs.push(val("wan_addr"));
      if (val("wan_addr6")) addrs.push(val("wan_addr6"));
    }
    var wanNic = val("wan_nic");
    var lanNic = val("lan_nic");
    var mgmtNic = val("mgmt_nic");
    var wanTagged = checked("wan_tagged");
    var lanTagged = checked("lan_tagged");
    var wanVid = parseInt(val("wan_vlan") || "10", 10);
    var lanVid = parseInt(val("lan_vlan") || "20", 10);
    if (wanNic === lanNic && wanTagged === lanTagged && (!wanTagged || wanVid === lanVid)) {
      err.textContent = "WAN and LAN must not share the same parent and tag";
      return;
    }
    if (mgmtNic && (wanNic === mgmtNic || lanNic === mgmtNic)) {
      err.textContent = "WAN or LAN must not share a parent with a Management NIC";
      return;
    }
    if (mgmtNic && !val("mgmt_prefix")) {
      err.textContent = "Management NIC needs an on-link static prefix";
      return;
    }
    var wanName = l2Name(wanNic, wanTagged, wanVid);
    var lanName = l2Name(lanNic, lanTagged, lanVid);
    var lanAddr = lanHost(val("lan_prefix"));
    var interfaces = [];
    if (wanTagged) {
      interfaces.push({
        name: wanName,
        role: "wan",
        parent: wanNic,
        vlan: wanVid,
        addresses: addrs,
        dhcp: dhcp,
      });
    } else {
      interfaces.push({
        name: wanName,
        role: "wan",
        addresses: addrs,
        dhcp: dhcp,
      });
    }
    if (lanTagged) {
      interfaces.push({
        name: lanName,
        role: "lan",
        parent: lanNic,
        vlan: lanVid,
        addresses: lanAddr ? [lanAddr] : [],
      });
    } else {
      interfaces.push({
        name: lanName,
        role: "lan",
        addresses: lanAddr ? [lanAddr] : [],
      });
    }
    if (mgmtNic) {
      interfaces.push({
        name: mgmtNic,
        role: "mgmt",
        addresses: [val("mgmt_prefix")],
      });
    }
    nics.forEach(function (n) {
      var used = n.name === wanNic || n.name === lanNic || n.name === mgmtNic;
      if (!used) {
        interfaces.push({ name: n.name, role: "unused" });
      } else if ((n.name === wanNic && wanTagged) || (n.name === lanNic && lanTagged)) {
        if (!interfaces.some(function (i) { return i.name === n.name; })) {
          interfaces.push({ name: n.name, role: "unused" });
        }
      }
    });
    var exposure = [];
    if (mgmtNic) exposure.push(mgmtNic);
    if (checked("expose_lan")) exposure.push(lanName);
    if (!exposure.length) {
      err.textContent = "ui_exposure must not be empty";
      return;
    }
    var payload = {
      hostname: val("hostname"),
      admin: val("admin"),
      password: document.getElementById("password").value,
      interfaces: interfaces,
      ui_exposure: exposure,
      lan_prefix: val("lan_prefix"),
      dhcp_pool: val("dhcp_pool"),
      wan_pd: val("wan_pd"),
    };
    try {
      var r = await fetch("/api/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      var j = await r.json();
      if (j.bootstrapped) {
        app.innerHTML = "<p>Bootstrap ownership is complete. Sign in at a UI-exposed address to review and repair configuration.</p>";
        window.setTimeout(load, 1000);
        return;
      }
      if (!r.ok || !j.ok) {
        err.textContent = j.error || r.statusText || "bootstrap failed";
        return;
      }
      app.innerHTML = "<p>Bootstrap complete. Reloading status…</p>";
      window.setTimeout(load, 1000);
    } catch (e) {
      err.textContent = "Connection lost while applying. Check the Appliance console or the configured UI address to confirm whether Bootstrap completed.";
    }
  }

  async function load() {
    try {
      var response = await fetch("/api/status", { credentials: "same-origin" });
      if (response.status === 401) {
        renderLogin();
        return;
      }
      if (!response.ok) throw new Error("Status is unavailable. Please reload.");
      var st = await response.json();
      if (st.bootstrapped) renderStatus(st);
      else renderWizard(st);
    } catch (e) {
      app.innerHTML = "<p class=\"err\">" + esc(e) + "</p>";
    }
  }

  load();
})();
