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

  function recoveryText(result) {
    if (result.restoration === "restored") return " Previous Accepted network restored.";
    if (result.restoration === "failed" || result.restoration === "required") {
      return " Network restoration needs recovery; check the Appliance console.";
    }
    return "";
  }

  var acceptedRoutes = [];
  var workingRoutes = [];
  var acceptedRevision = 0;
  var pendingDraft = null;
  var draftReviewMode = null;
  var editingRoute = -1;
  var editingOriginal = null;
  var routeEditBaseRevision = null;
  var routeFormDirty = false;
  var removingRoute = null;
  var removingBaseRevision = null;
  var proposedRoutes = null;
  var pendingApply = null;
  var reviewedPending = null;

  function updateRouteShortcutAvailability() {
    var review = document.getElementById("route-review");
    var shortcut = document.getElementById("route-save-and-apply");
    if (shortcut) shortcut.disabled = !!pendingDraft || !!pendingApply || !review.hidden;
    var removeShortcut = document.getElementById("route-remove-save-and-apply");
    if (removeShortcut) removeShortcut.disabled = !!pendingDraft || !!pendingApply || !removingRoute || routeFormDirty;
    document.querySelectorAll("#route-list [data-edit], #route-list [data-remove]").forEach(function (button) {
      button.disabled = routeFormDirty || !review.hidden;
    });
  }

  function resetRouteForm() {
    document.getElementById("route-form").reset();
    editingRoute = -1;
    editingOriginal = null;
    routeEditBaseRevision = null;
    routeFormDirty = false;
  }

  function actorText(actor) {
    if (!actor) return "Legacy client";
    return actor.username + " (" + actor.source + ", " + actor.subject + ")";
  }

  async function loadApplyConfirmation() {
    var status = document.getElementById("apply-confirmation-status");
    if (!status) return;
    try {
      var response = await fetch("/api/apply-confirmation", { credentials: "same-origin" });
      var result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Apply confirmation unavailable");
      pendingApply = result.pending;
      if (!pendingApply || (reviewedPending &&
          (reviewedPending.revision !== pendingApply.revision || reviewedPending.confirmation_id !== pendingApply.confirmation_id))) {
        reviewedPending = null;
        document.getElementById("pending-apply-review").hidden = true;
      }
      document.getElementById("apply-confirmation-enabled").checked = !!result.enabled;
      document.getElementById("apply-confirmation-revision").value = result.accepted_revision;
      status.textContent = result.enabled
        ? "Enabled: new applies need acknowledgement within two minutes."
        : "Disabled: durable applies are accepted immediately.";
      var pendingText = document.getElementById("pending-apply-status");
      pendingText.textContent = pendingApply
        ? "Pending revision " + pendingApply.revision + " applied by " + actorText(pendingApply.applying) +
          ". Confirm by " + new Date(pendingApply.expires_at_unix_ms).toLocaleTimeString() +
          ". Routes: " + (pendingApply.routes || []).map(function (route) { return route.to + " via " + route.via; }).join(", ")
        : "No revision awaits confirmation.";
      document.getElementById("review-apply").hidden = !pendingApply;
      if (result.last_accepted) {
        document.getElementById("last-apply-actors").textContent =
          "Accepted revision " + result.last_accepted.revision + " applied by " +
          actorText(result.last_accepted.applying) +
          (result.last_accepted.confirming ? "; confirmed by " + actorText(result.last_accepted.confirming) : "");
      }
      var routeApply = document.getElementById("route-apply");
      if (routeApply) routeApply.disabled = !!pendingDraft || !!pendingApply;
      var draftApply = document.getElementById("draft-apply");
      if (draftApply) draftApply.disabled = !!pendingApply;
      updateRouteShortcutAvailability();
    } catch (error) {
      status.textContent = "Could not load Apply confirmation: " + error.message;
    }
  }

  function setupApplyConfirmation() {
    loadApplyConfirmation();
    document.getElementById("apply-confirmation-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      var button = event.currentTarget.querySelector("button");
      button.disabled = true;
      try {
        var response = await fetch("/api/apply-confirmation/configure", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base_revision: Number(val("apply-confirmation-revision")),
            enabled: checked("apply-confirmation-enabled"),
          }),
        });
        var result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "setting change failed");
        document.getElementById("apply-confirmation-result").textContent =
          result.outcome === "pending_confirmation"
            ? "Revision " + result.revision + " is pending confirmation."
            : "Setting accepted in revision " + result.revision;
        await loadApplyConfirmation();
        await loadRoutes();
      } catch (error) {
        document.getElementById("apply-confirmation-result").textContent = "Setting change failed: " + error.message;
        await loadApplyConfirmation();
      } finally {
        button.disabled = false;
      }
    });
    document.getElementById("review-apply").addEventListener("click", function () {
      if (!pendingApply || !pendingApply.confirmation_id) return;
      reviewedPending = pendingApply;
      document.getElementById("pending-apply-review-heading").textContent =
        "Review applied revision " + reviewedPending.revision;
      document.getElementById("pending-apply-review-details").textContent =
        "Confirmation ID: " + reviewedPending.confirmation_id + ". Applied by " + actorText(reviewedPending.applying) +
        ". Previous Accepted revision " + reviewedPending.base_revision +
        ". Confirm by " + new Date(reviewedPending.expires_at_unix_ms).toLocaleTimeString() + ".\n" +
        "Apply confirmation setting: " +
        (reviewedPending.accepted_review.apply_confirmation ? "enabled" : "disabled") + " → " +
        (reviewedPending.proposed_review.apply_confirmation ? "enabled" : "disabled") + ".\n" +
        "Routes: " + JSON.stringify(reviewedPending.accepted_review.routes) + " → " +
        JSON.stringify(reviewedPending.proposed_review.routes) + ".\n" +
        "Other Desired state (accepted → proposed):\n" +
        JSON.stringify(reviewedPending.accepted_review, null, 2) + "\n→\n" +
        JSON.stringify(reviewedPending.proposed_review, null, 2);
      document.getElementById("pending-apply-review").hidden = false;
    });
    document.getElementById("confirm-reviewed-apply").addEventListener("click", async function (event) {
      if (!reviewedPending || !pendingApply ||
          reviewedPending.revision !== pendingApply.revision ||
          reviewedPending.confirmation_id !== pendingApply.confirmation_id) return;
      var button = event.currentTarget;
      var revision = reviewedPending.revision;
      var confirmationId = reviewedPending.confirmation_id;
      button.disabled = true;
      try {
        var response = await fetch("/api/apply-confirmation/confirm", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: revision, confirmation_id: confirmationId }),
        });
        var result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "confirmation failed");
        document.getElementById("apply-confirmation-result").textContent = "Accepted revision " + result.revision;
        reviewedPending = null;
        document.getElementById("pending-apply-review").hidden = true;
        await loadRoutes();
      } catch (error) {
        document.getElementById("apply-confirmation-result").textContent = "Confirmation failed: " + error.message;
      } finally {
        await loadApplyConfirmation();
      }
    });
    setInterval(loadApplyConfirmation, 3000);
  }

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
      document.getElementById("route-apply").disabled = !!pendingDraft || !!pendingApply;
      updateRouteShortcutAvailability();
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
          if (routeFormDirty || !document.getElementById("route-review").hidden) return;
          editingRoute = Number(button.dataset.edit);
          editingOriginal = acceptedRoutes[editingRoute] ? Object.assign({}, acceptedRoutes[editingRoute]) : null;
          routeEditBaseRevision = acceptedRevision;
          removingRoute = null;
          removingBaseRevision = null;
          var route = workingRoutes[editingRoute];
          document.getElementById("route-destination").value = route.to;
          document.getElementById("route-gateway").value = route.via;
          select.value = route.dev || "";
          routeFormDirty = true;
          updateRouteShortcutAvailability();
          document.getElementById("route-destination").focus();
        });
      });
      list.querySelectorAll("[data-remove]").forEach(function (button) {
        button.addEventListener("click", function () {
          if (routeFormDirty || !document.getElementById("route-review").hidden) return;
          var index = Number(button.dataset.remove);
          removingRoute = Object.assign({}, workingRoutes[index]);
          removingBaseRevision = acceptedRevision;
          proposedRoutes = workingRoutes.filter(function (_, i) { return i !== index; });
          showRouteReview("Remove " + workingRoutes[index].to + " via " + workingRoutes[index].via);
          document.getElementById("route-remove-save-and-apply").hidden = false;
        });
      });
      updateRouteShortcutAvailability();
    } catch (error) {
      document.getElementById("route-result").textContent = "Could not load Accepted routes: " + error.message;
    }
  }

  function showRouteReview(summary) {
    document.getElementById("route-review").hidden = false;
    document.getElementById("route-remove-save-and-apply").hidden = !removingRoute;
    document.getElementById("route-summary").textContent = summary +
      ". Review against Accepted revision " +
      (pendingDraft ? pendingDraft.base_revision : acceptedRevision);
    document.getElementById("route-result").textContent = "";
    updateRouteShortcutAvailability();
  }

  function setupRoutes() {
    editingRoute = -1;
    editingOriginal = null;
    routeEditBaseRevision = null;
    routeFormDirty = false;
    removingRoute = null;
    removingBaseRevision = null;
    loadRoutes();
    function markRouteFormDirty() {
      if (routeEditBaseRevision === null) routeEditBaseRevision = acceptedRevision;
      routeFormDirty = true;
      updateRouteShortcutAvailability();
    }
    document.getElementById("route-form").addEventListener("input", markRouteFormDirty);
    document.getElementById("route-form").addEventListener("change", markRouteFormDirty);
    document.getElementById("route-cancel-edit").addEventListener("click", function () {
      resetRouteForm();
      updateRouteShortcutAvailability();
    });
    document.getElementById("route-form").addEventListener("submit", function (event) {
      event.preventDefault();
      removingRoute = null;
      var route = { to: val("route-destination"), via: val("route-gateway") };
      if (val("route-interface")) route.dev = val("route-interface");
      proposedRoutes = workingRoutes.slice();
      if (editingRoute >= 0) proposedRoutes[editingRoute] = route;
      else proposedRoutes.push(route);
      showRouteReview((editingRoute >= 0 ? "Change " : "Add ") + route.to + " via " + route.via +
        (route.dev ? " on " + route.dev : ""));
    });
    async function applyStandalone(change, button) {
      button.disabled = true;
      try {
        var response = await fetch("/api/routes/save-and-apply", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(change),
        });
        var result = await response.json();
        if (!response.ok || !result.ok) {
          document.getElementById("route-result").textContent =
            (result.outcome === "rejected" ? "Rejected: " : "Apply failed: ") +
            (result.error || "Route change unavailable") + recoveryText(result);
          return;
        }
        document.getElementById("route-review").hidden = true;
        document.getElementById("route-result").textContent = result.outcome === "pending_confirmation"
          ? "Revision " + result.revision + " is pending confirmation."
          : "Accepted revision " + result.revision;
        resetRouteForm();
        removingRoute = null;
        removingBaseRevision = null;
        proposedRoutes = null;
        await loadRoutes();
        await loadApplyConfirmation();
      } catch (_) {
        document.getElementById("route-result").textContent = "Apply outcome unavailable; reload routes before retrying.";
      } finally {
        updateRouteShortcutAvailability();
      }
    }
    document.getElementById("route-save-and-apply").addEventListener("click", async function (event) {
      if (pendingDraft || pendingApply || !document.getElementById("route-review").hidden) return;
      if (!document.getElementById("route-form").reportValidity()) return;
      var route = { to: val("route-destination"), via: val("route-gateway") };
      if (val("route-interface")) route.dev = val("route-interface");
      var change = {
        base_revision: routeEditBaseRevision === null ? acceptedRevision : routeEditBaseRevision,
        action: editingRoute >= 0 ? "change" : "add", route: route,
      };
      if (editingRoute >= 0) change.original = editingOriginal;
      await applyStandalone(change, event.currentTarget);
    });
    document.getElementById("route-remove-save-and-apply").addEventListener("click", async function (event) {
      if (pendingDraft || pendingApply || !removingRoute || routeFormDirty) return;
      await applyStandalone({ base_revision: removingBaseRevision, action: "remove", original: removingRoute }, event.currentTarget);
    });
    document.getElementById("route-cancel-review").addEventListener("click", function () {
      document.getElementById("route-review").hidden = true;
      proposedRoutes = null;
      removingRoute = null;
      removingBaseRevision = null;
      updateRouteShortcutAvailability();
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
        resetRouteForm();
        removingRoute = null;
        removingBaseRevision = null;
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
          document.getElementById("route-result").textContent =
            (result.outcome === "rejected" ? "Rejected: " : "Apply failed: ") +
            (result.error || "Route change unavailable") + recoveryText(result);
          return;
        }
        document.getElementById("route-review").hidden = true;
        removingRoute = null;
        removingBaseRevision = null;
        document.getElementById("route-result").textContent = result.outcome === "pending_confirmation"
          ? "Revision " + result.revision + " is pending confirmation."
          : "Accepted revision " + result.revision;
        resetRouteForm();
        proposedRoutes = null;
        await loadRoutes();
        await loadApplyConfirmation();
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
        "; current Accepted revision " + acceptedRevision + "." +
        interfaceDraftText(pendingDraft) + serviceDraftText(pendingDraft) + policyDraftText(pendingDraft) + wireGuardDraftText(pendingDraft);
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
          document.getElementById("route-result").textContent = response.status === 409
            ? "Stale draft retained: " + (result.error || "review reconciliation")
            : "Draft apply failed; draft retained: " + (result.error || "unknown error") + recoveryText(result);
          await loadRoutes();
          return;
        }
        document.getElementById("draft-review-panel").hidden = true;
        document.getElementById("route-result").textContent = result.outcome === "pending_confirmation"
          ? "Revision " + result.revision + " is pending confirmation; your draft is retained."
          : "Accepted revision " + result.revision;
        await loadRoutes();
        await loadApplyConfirmation();
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
        ". Saving does not apply; review the new draft again before applying." +
        interfaceDraftText(pendingDraft) + serviceDraftText(pendingDraft) + policyDraftText(pendingDraft) + wireGuardDraftText(pendingDraft);
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
          body: JSON.stringify(reconcilePayload()),
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

  function interfaceDraftText(draft) {
    if (!draft || !(draft.sections || []).some(function (section) { return section === "interfaces"; })) {
      return "";
    }
    return " Interfaces: " + (draft.interfaces || []).map(function (iface) {
      return iface.name + " " + (iface.role || "unset") +
        (iface.vlan ? " vlan " + iface.vlan : "") +
        (iface.addresses && iface.addresses.length ? " " + iface.addresses.join(" ") : "");
    }).join(", ") + ". UI exposure: " + (draft.ui_exposure || []).join(", ") + ".";
  }

  function reconcilePayload() {
    var payload = {
      base_revision: pendingDraft.base_revision,
      version: pendingDraft.version,
      accepted_revision: acceptedRevision,
      routes: pendingDraft.routes,
    };
    if ((pendingDraft.sections || []).indexOf("interfaces") >= 0) {
      payload.interfaces = pendingDraft.interfaces;
      payload.ui_exposure = pendingDraft.ui_exposure;
    }
    if ((pendingDraft.sections || []).indexOf("services") >= 0) {
      payload.services = {
        lan_prefix: pendingDraft.lan_prefix || "",
        dhcp_pool: pendingDraft.dhcp_pool || "",
        wan_pd: pendingDraft.wan_pd || "",
      };
    }
    if ((pendingDraft.sections || []).indexOf("firewall") >= 0) {
      payload.firewall = pendingDraft.firewall || [];
    }
    if ((pendingDraft.sections || []).indexOf("wireguard") >= 0) {
      payload.wireguard = (pendingDraft.wireguard || []).map(function (tunnel) {
        return {
          name: tunnel.name,
          listen_port: tunnel.listen_port,
          addresses: tunnel.addresses || [],
          private_key: "",
        };
      });
    }
    return payload;
  }

  function wireGuardDraftText(draft) {
    if (!draft || !(draft.sections || []).some(function (section) { return section === "wireguard"; })) {
      return "";
    }
    return " WireGuard: " + (draft.wireguard || []).map(function (tunnel) {
      return tunnel.name + " port " + (tunnel.listen_port || "auto") +
        " " + (tunnel.addresses || []).join(" ") +
        (tunnel.private_key_set ? " private key set" : " private key missing");
    }).join("; ") + ".";
  }

  function policyDraftText(draft) {
    if (!draft || !(draft.sections || []).some(function (section) { return section === "firewall"; })) {
      return "";
    }
    return " Firewall policy: " + (draft.firewall || []).join("; ") + ".";
  }

  function serviceDraftText(draft) {
    if (!draft || !(draft.sections || []).some(function (section) { return section === "services"; })) {
      return "";
    }
    return " " + serviceSummary({
      lan_prefix: draft.lan_prefix || "",
      dhcp_pool: draft.dhcp_pool || "",
      wan_pd: draft.wan_pd || "",
    }).replace(/ Review against Accepted revision .*$/, ".");
  }

  var interfaceNics = [];
  var proposedInterfaces = null;

  function parentOptions(selected) {
    var names = interfaceNics.map(function (nic) { return nic.name; });
    return "<option value=\"\"></option>" + names.map(function (name) {
      return "<option value=\"" + esc(name) + "\"" + (name === selected ? " selected" : "") + ">" + esc(name) + "</option>";
    }).join("");
  }

  function roleOptions(selected) {
    return ["wan", "lan", "mgmt", "unused"].map(function (role) {
      return "<option value=\"" + role + "\"" + (role === selected ? " selected" : "") + ">" + role + "</option>";
    }).join("");
  }

  function syncInterfaceRow(row) {
    var role = row.querySelector("[data-field=role]").value;
    var vlan = row.querySelector("[data-field=vlan]");
    var parent = row.querySelector("[data-field=parent]");
    var dhcp = row.querySelector("[data-field=dhcp]");
    var expose = row.querySelector("[data-field=expose]");
    var mgmt = role === "mgmt";
    var wan = role === "wan";
    vlan.disabled = mgmt;
    parent.disabled = mgmt;
    dhcp.disabled = mgmt;
    if (mgmt) {
      var parentName = parent.value;
      vlan.value = "";
      parent.value = "";
      dhcp.checked = false;
      expose.checked = true;
      var name = row.querySelector("[data-field=name]");
      if (parentName) name.value = parentName;
      else if (name.value.indexOf(".") >= 0) name.value = name.value.split(".")[0];
      name.readOnly = true;
    }
    if (wan) expose.checked = false;
    expose.disabled = mgmt || wan;
    row.querySelector("[data-remove]").hidden = !vlan.value;
  }

  function interfaceRow(iface, exposure) {
    var vlan = iface.vlan || "";
    var row = document.createElement("div");
    row.className = "nic";
    row.setAttribute("data-interface-row", "");
    row.innerHTML =
      "<label>Name <input data-field=\"name\" value=\"" + esc(iface.name || "") + "\"" + (vlan ? "" : " readonly") + "></label>" +
      "<label>Role <select data-field=\"role\">" + roleOptions(iface.role || "unused") + "</select></label>" +
      "<label>Addresses <input data-field=\"addresses\" value=\"" + esc((iface.addresses || []).join(" ")) + "\" placeholder=\"203.0.113.1/24\"></label>" +
      "<label><input data-field=\"dhcp\" type=\"checkbox\"" + (iface.dhcp ? " checked" : "") + "> DHCP</label>" +
      "<label>Parent <select data-field=\"parent\">" + parentOptions(iface.parent || "") + "</select></label>" +
      "<label>VLAN <input data-field=\"vlan\" value=\"" + esc(vlan) + "\" inputmode=\"numeric\"></label>" +
      "<label><input data-field=\"expose\" type=\"checkbox\"" +
      ((exposure || []).indexOf(iface.name) >= 0 ? " checked" : "") + "> UI exposure</label>" +
      "<button type=\"button\" data-remove>Remove VLAN</button>";
    row.querySelector("[data-field=role]").addEventListener("change", function () { syncInterfaceRow(row); });
    row.querySelector("[data-field=vlan]").addEventListener("input", function () { syncInterfaceRow(row); });
    row.querySelector("[data-remove]").addEventListener("click", function () { row.remove(); });
    syncInterfaceRow(row);
    return row;
  }

  function collectInterfaces() {
    var interfaces = [];
    var exposure = [];
    document.querySelectorAll("#interface-rows [data-interface-row]").forEach(function (row) {
      var name = row.querySelector("[data-field=name]").value.trim();
      if (!name) return;
      var role = row.querySelector("[data-field=role]").value;
      var addresses = row.querySelector("[data-field=addresses]").value.split(/[\s,]+/).filter(Boolean);
      var vlanRaw = row.querySelector("[data-field=vlan]").value.trim();
      var parent = row.querySelector("[data-field=parent]").value;
      var iface = { name: name, role: role };
      if (addresses.length) iface.addresses = addresses;
      if (row.querySelector("[data-field=dhcp]").checked) iface.dhcp = true;
      if (vlanRaw) {
        iface.vlan = parseInt(vlanRaw, 10);
        if (parent) iface.parent = parent;
      }
      interfaces.push(iface);
      if (row.querySelector("[data-field=expose]").checked) exposure.push(name);
    });
    return { interfaces: interfaces, ui_exposure: exposure };
  }

  function interfaceSummary(proposal) {
    return (proposal.interfaces || []).map(function (iface) {
      return iface.name + " " + (iface.role || "unset") +
        (iface.vlan ? " vlan " + iface.vlan + (iface.parent ? " on " + iface.parent : "") : "") +
        (iface.addresses ? " " + iface.addresses.join(" ") : "") +
        (iface.dhcp ? " dhcp" : "");
    }).join(", ") + ". UI exposure: " + (proposal.ui_exposure || []).join(", ") +
      ". Review against Accepted revision " + (pendingDraft ? pendingDraft.base_revision : acceptedRevision);
  }

  async function loadInterfaces() {
    var rows = document.getElementById("interface-rows");
    if (!rows) return;
    var response = await fetch("/api/interfaces", { credentials: "same-origin" });
    var result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Interfaces unavailable");
    var draftResponse = await fetch("/api/draft", { credentials: "same-origin" });
    var draft = await draftResponse.json();
    if (!draftResponse.ok || !draft.ok) throw new Error(draft.error || "Draft unavailable");
    pendingDraft = draft.status === "pending" ? draft : null;
    acceptedRevision = result.revision;
    interfaceNics = result.nics || [];
    var working = pendingDraft ? pendingDraft.interfaces : result.interfaces;
    var exposure = pendingDraft ? pendingDraft.ui_exposure : result.ui_exposure;
    document.getElementById("accepted-interface-status").textContent =
      "Accepted revision " + result.revision + ". LAN prefix " + (result.lan_prefix || "");
    document.getElementById("interface-draft-note").textContent = pendingDraft
      ? "Editing the private draft based on Accepted revision " + pendingDraft.base_revision
      : "No private pending draft";
    document.getElementById("interface-save-and-apply").disabled = !!pendingDraft || !!pendingApply;
    document.getElementById("interface-apply").disabled = !!pendingDraft || !!pendingApply;
    rows.innerHTML = "";
    (working || []).forEach(function (iface) {
      rows.appendChild(interfaceRow(iface, exposure));
    });
    interfaceNics.forEach(function (nic) {
      if (![].some.call(rows.querySelectorAll("[data-field=name]"), function (input) { return input.value === nic.name; })) {
        rows.appendChild(interfaceRow({ name: nic.name, role: "unused", addresses: [] }, exposure));
      }
    });
  }

  function setupInterfaces() {
    proposedInterfaces = null;
    var review = document.getElementById("interface-review-panel");
    loadInterfaces().catch(function (error) {
      var result = document.getElementById("interface-result");
      if (result) result.textContent = "Could not load interfaces: " + error.message;
    });
    document.getElementById("interface-add-vlan").addEventListener("click", function () {
      var parent = interfaceNics[0] ? interfaceNics[0].name : "";
      var vlan = 20;
      document.getElementById("interface-rows").appendChild(interfaceRow({
        name: parent ? parent + "." + vlan : "",
        role: "lan",
        parent: parent,
        vlan: vlan,
        addresses: [],
      }, []));
    });
    document.getElementById("interface-review").addEventListener("click", function () {
      proposedInterfaces = collectInterfaces();
      document.getElementById("interface-summary").textContent = interfaceSummary(proposedInterfaces);
      review.hidden = false;
      document.getElementById("interface-result").textContent = "";
    });
    document.getElementById("interface-cancel-review").addEventListener("click", function () {
      review.hidden = true;
      proposedInterfaces = null;
    });
    document.getElementById("interface-save-draft").addEventListener("click", async function (event) {
      if (!proposedInterfaces) return;
      var button = event.currentTarget;
      button.disabled = true;
      try {
        var response = await fetch("/api/draft/save", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base_revision: pendingDraft ? pendingDraft.base_revision : acceptedRevision,
            version: pendingDraft ? pendingDraft.version : null,
            interfaces: proposedInterfaces.interfaces,
            ui_exposure: proposedInterfaces.ui_exposure,
          }),
        });
        var result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Draft save failed");
        review.hidden = true;
        document.getElementById("interface-result").textContent =
          "Draft saved against Accepted revision " + result.base_revision + "; networking unchanged";
        await loadInterfaces();
        await loadRoutes();
      } catch (error) {
        document.getElementById("interface-result").textContent = "Draft save failed: " + error.message;
      } finally {
        button.disabled = false;
      }
    });
    async function applyInterfaceProposal(path, button) {
      if (!proposedInterfaces && path.indexOf("save-and-apply") < 0) return;
      var proposal = path.indexOf("save-and-apply") >= 0 ? collectInterfaces() : proposedInterfaces;
      button.disabled = true;
      try {
        var response = await fetch(path, {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base_revision: acceptedRevision,
            interfaces: proposal.interfaces,
            ui_exposure: proposal.ui_exposure,
          }),
        });
        var result = await response.json();
        if (!response.ok || !result.ok) {
          document.getElementById("interface-result").textContent =
            (result.outcome === "rejected" ? "Rejected: " : "Apply failed: ") +
            (result.error || "Interface change unavailable") + recoveryText(result);
          return;
        }
        review.hidden = true;
        proposedInterfaces = null;
        document.getElementById("interface-result").textContent = result.outcome === "pending_confirmation"
          ? "Revision " + result.revision + " is pending confirmation."
          : "Accepted revision " + result.revision;
        await loadInterfaces();
        await loadRoutes();
        await loadApplyConfirmation();
      } catch (_) {
        document.getElementById("interface-result").textContent = "Apply outcome unavailable; reload interfaces before retrying.";
      } finally {
        button.disabled = false;
      }
    }
    document.getElementById("interface-apply").addEventListener("click", function (event) {
      if (pendingDraft || pendingApply) return;
      applyInterfaceProposal("/api/interfaces/apply", event.currentTarget);
    });
    document.getElementById("interface-save-and-apply").addEventListener("click", function (event) {
      if (pendingDraft || pendingApply) return;
      applyInterfaceProposal("/api/interfaces/save-and-apply", event.currentTarget);
    });
  }

  function prefixHost(prefix) {
    var parts = String(prefix || "").split("/")[0].split(".");
    if (parts.length !== 4 || parts.some(function (part) { return part === "" || Number(part) > 255; })) return "";
    if (parts[3] === "0") parts[3] = "1";
    return parts.join(".");
  }

  function collectServices() {
    return {
      lan_prefix: val("service-prefix"),
      dhcp_pool: val("service-pool"),
      wan_pd: val("service-pd"),
    };
  }

  function serviceSummary(services) {
    return "LAN prefix " + services.lan_prefix + ". DHCP pool " + services.dhcp_pool +
      ". WAN prefix delegation " + (services.wan_pd || "none") +
      ". DNS resolver " + (prefixHost(services.lan_prefix) || "none") +
      ". Review against Accepted revision " + (pendingDraft ? pendingDraft.base_revision : acceptedRevision);
  }

  async function loadLanServices() {
    var status = document.getElementById("accepted-service-status");
    if (!status) return;
    var response = await fetch("/api/lan-services", { credentials: "same-origin" });
    var result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "LAN services unavailable");
    var draftResponse = await fetch("/api/draft", { credentials: "same-origin" });
    var draft = await draftResponse.json();
    if (!draftResponse.ok || !draft.ok) throw new Error(draft.error || "Draft unavailable");
    pendingDraft = draft.status === "pending" ? draft : null;
    acceptedRevision = result.revision;
    var prefix = pendingDraft ? (pendingDraft.lan_prefix || "") : (result.lan_prefix || "");
    var pool = pendingDraft ? (pendingDraft.dhcp_pool || "") : (result.dhcp_pool || "");
    var pd = pendingDraft ? (pendingDraft.wan_pd || "") : (result.wan_pd || "");
    document.getElementById("service-prefix").value = prefix;
    document.getElementById("service-pool").value = pool;
    document.getElementById("service-pd").value = pd;
    status.textContent = "Accepted revision " + result.revision +
      (result.lan ? ". Services follow " + result.lan : "");
    document.getElementById("service-dns").textContent =
      "DNS resolver " + (prefixHost(result.lan_prefix) || "none") + " is advertised to DHCP clients.";
    document.getElementById("service-draft-note").textContent = pendingDraft
      ? "Editing the private draft based on Accepted revision " + pendingDraft.base_revision
      : "No private pending draft";
    document.getElementById("service-save-and-apply").disabled = !!pendingDraft || !!pendingApply;
    document.getElementById("service-apply").disabled = !!pendingDraft || !!pendingApply;
  }

  function setupLanServices() {
    var review = document.getElementById("service-review-panel");
    var proposed = null;
    loadLanServices().catch(function (error) {
      var result = document.getElementById("service-result");
      if (result) result.textContent = "Could not load LAN services: " + error.message;
    });
    document.getElementById("service-review").addEventListener("click", function () {
      proposed = collectServices();
      document.getElementById("service-summary").textContent = serviceSummary(proposed);
      review.hidden = false;
      document.getElementById("service-result").textContent = "";
    });
    document.getElementById("service-save-draft").addEventListener("click", async function (event) {
      if (!proposed) return;
      var button = event.currentTarget;
      button.disabled = true;
      try {
        var response = await fetch("/api/draft/save", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base_revision: pendingDraft ? pendingDraft.base_revision : acceptedRevision,
            version: pendingDraft ? pendingDraft.version : null,
            services: proposed,
          }),
        });
        var result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Draft save failed");
        review.hidden = true;
        document.getElementById("service-result").textContent =
          "Draft saved against Accepted revision " + result.base_revision + "; networking unchanged";
        await loadLanServices();
        await loadRoutes();
      } catch (error) {
        document.getElementById("service-result").textContent = "Draft save failed: " + error.message;
      } finally {
        button.disabled = false;
      }
    });
    async function applyServices(path, button) {
      var services = path.indexOf("save-and-apply") >= 0 ? collectServices() : proposed;
      if (!services) return;
      button.disabled = true;
      try {
        var response = await fetch(path, {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base_revision: acceptedRevision, services: services }),
        });
        var result = await response.json();
        if (!response.ok || !result.ok) {
          document.getElementById("service-result").textContent =
            (result.outcome === "rejected" ? "Rejected: " : "Apply failed: ") +
            (result.error || "LAN service change unavailable") + recoveryText(result);
          return;
        }
        review.hidden = true;
        proposed = null;
        document.getElementById("service-result").textContent = result.outcome === "pending_confirmation"
          ? "Revision " + result.revision + " is pending confirmation."
          : "Accepted revision " + result.revision;
        await loadLanServices();
        await loadRoutes();
        await loadApplyConfirmation();
      } catch (_) {
        document.getElementById("service-result").textContent =
          "Apply outcome unavailable; reload LAN services before retrying.";
      } finally {
        button.disabled = false;
      }
    }
    document.getElementById("service-apply").addEventListener("click", function (event) {
      if (pendingDraft || pendingApply) return;
      applyServices("/api/lan-services/apply", event.currentTarget);
    });
    document.getElementById("service-save-and-apply").addEventListener("click", function (event) {
      if (pendingDraft || pendingApply) return;
      applyServices("/api/lan-services/save-and-apply", event.currentTarget);
    });
  }

  var acceptedPolicy = [];

  function policyLine() {
    var iface = val("policy-interface");
    var source = val("policy-source");
    var protocol = val("policy-protocol");
    var port = val("policy-port");
    var action = val("policy-action");
    var parts = [];
    if (iface) parts.push("iifname \"" + iface + "\"");
    if (source) parts.push("ip saddr " + source);
    if (protocol === "icmp") parts.push("icmp type echo-request");
    else if ((protocol === "tcp" || protocol === "udp") && port) parts.push(protocol + " dport " + port);
    else if (protocol === "tcp" || protocol === "udp") parts.push(protocol);
    parts.push(action || "drop");
    return parts.join(" ");
  }

  function proposedPolicy() {
    var line = policyLine();
    var rules = acceptedPolicy.slice();
    if (pendingDraft && pendingDraft.firewall) rules = pendingDraft.firewall.slice();
    if (line && rules.indexOf(line) < 0) rules.push(line);
    return rules;
  }

  async function loadPolicy() {
    var status = document.getElementById("accepted-policy-status");
    if (!status) return;
    var response = await fetch("/api/firewall", { credentials: "same-origin" });
    var result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Firewall policy unavailable");
    var draftResponse = await fetch("/api/draft", { credentials: "same-origin" });
    var draft = await draftResponse.json();
    if (!draftResponse.ok || !draft.ok) throw new Error(draft.error || "Draft unavailable");
    pendingDraft = draft.status === "pending" ? draft : null;
    acceptedRevision = result.revision;
    acceptedPolicy = result.rules || [];
    var select = document.getElementById("policy-interface");
    select.innerHTML = "<option value=\"\"></option>" + (result.interfaces || []).map(function (iface) {
      return "<option value=\"" + esc(iface.name) + "\">" + esc(iface.name + " " + (iface.role || "")) + "</option>";
    }).join("");
    var shown = pendingDraft && pendingDraft.firewall ? pendingDraft.firewall : acceptedPolicy;
    document.getElementById("policy-rules").innerHTML = shown.length
      ? shown.map(function (rule) { return "<li>" + esc(rule) + "</li>"; }).join("")
      : "<li>No extra firewall rules</li>";
    status.textContent = "Accepted revision " + result.revision;
    document.getElementById("policy-save-and-apply").disabled = !!pendingDraft || !!pendingApply;
    document.getElementById("policy-apply").disabled = !!pendingDraft || !!pendingApply;
  }

  function setupPolicy() {
    var review = document.getElementById("policy-review-panel");
    var proposed = null;
    loadPolicy().catch(function (error) {
      var result = document.getElementById("policy-result");
      if (result) result.textContent = "Could not load firewall policy: " + error.message;
    });
    document.getElementById("policy-review").addEventListener("click", function () {
      proposed = proposedPolicy();
      document.getElementById("policy-summary").textContent =
        "Firewall policy: " + proposed.join("; ") +
        ". Review against Accepted revision " + (pendingDraft ? pendingDraft.base_revision : acceptedRevision);
      review.hidden = false;
      document.getElementById("policy-result").textContent = "";
    });
    document.getElementById("policy-save-draft").addEventListener("click", async function (event) {
      if (!proposed) return;
      var button = event.currentTarget;
      button.disabled = true;
      try {
        var response = await fetch("/api/draft/save", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base_revision: pendingDraft ? pendingDraft.base_revision : acceptedRevision,
            version: pendingDraft ? pendingDraft.version : null,
            firewall: proposed,
          }),
        });
        var result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Draft save failed");
        review.hidden = true;
        document.getElementById("policy-result").textContent =
          "Draft saved against Accepted revision " + result.base_revision + "; networking unchanged";
        await loadPolicy();
        await loadRoutes();
      } catch (error) {
        document.getElementById("policy-result").textContent = "Draft save failed: " + error.message;
      } finally {
        button.disabled = false;
      }
    });
    async function applyPolicy(path, button) {
      var rules = path.indexOf("save-and-apply") >= 0 ? proposedPolicy() : proposed;
      if (!rules) return;
      button.disabled = true;
      try {
        var response = await fetch(path, {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base_revision: acceptedRevision, rules: rules }),
        });
        var result = await response.json();
        if (!response.ok || !result.ok) {
          document.getElementById("policy-result").textContent =
            (result.outcome === "rejected" ? "Rejected: " : "Apply failed: ") +
            (result.error || "Firewall policy unavailable") + recoveryText(result);
          return;
        }
        review.hidden = true;
        proposed = null;
        document.getElementById("policy-result").textContent = result.outcome === "pending_confirmation"
          ? "Revision " + result.revision + " is pending confirmation."
          : "Accepted revision " + result.revision;
        await loadPolicy();
        await loadRoutes();
        await loadApplyConfirmation();
      } catch (_) {
        document.getElementById("policy-result").textContent =
          "Apply outcome unavailable; reload firewall policy before retrying.";
      } finally {
        button.disabled = false;
      }
    }
    document.getElementById("policy-apply").addEventListener("click", function (event) {
      if (pendingDraft || pendingApply) return;
      applyPolicy("/api/firewall/apply", event.currentTarget);
    });
    document.getElementById("policy-save-and-apply").addEventListener("click", function (event) {
      if (pendingDraft || pendingApply) return;
      applyPolicy("/api/firewall/save-and-apply", event.currentTarget);
    });
  }

  function wireGuardTunnel() {
    var port = val("wireguard-port");
    var tunnel = {
      name: val("wireguard-name"),
      private_key: document.getElementById("wireguard-key").value,
      addresses: val("wireguard-addresses").split(/[\s,]+/).filter(Boolean),
      route_to: val("wireguard-route-to"),
      route_via: val("wireguard-route-via"),
    };
    if (port) tunnel.listen_port = Number(port);
    return tunnel;
  }

  function wireGuardProblem(tunnel) {
    var port = val("wireguard-port");
    if (port && !/^[1-9]\d{0,4}$/.test(port)) return "WireGuard needs a usable listen port";
    if (Number(port) > 65535) return "WireGuard needs a usable listen port";
    if ((tunnel.route_to && !tunnel.route_via) || (!tunnel.route_to && tunnel.route_via)) {
      return "WireGuard route needs both a destination and a next hop";
    }
    return "";
  }

  function wireGuardSummary(tunnel) {
    return "WireGuard " + tunnel.name +
      " port " + (tunnel.listen_port || "auto") +
      " " + (tunnel.addresses || []).join(" ") +
      (tunnel.private_key ? " private key entered" : " private key unchanged") +
      (tunnel.route_to ? " route " + tunnel.route_to + " via " + tunnel.route_via : "") +
      ". Review against Accepted revision " + (pendingDraft ? pendingDraft.base_revision : acceptedRevision);
  }

  async function loadWireGuard() {
    var status = document.getElementById("accepted-wireguard-status");
    if (!status) return;
    var response = await fetch("/api/wireguard", { credentials: "same-origin" });
    var result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "WireGuard unavailable");
    var draftResponse = await fetch("/api/draft", { credentials: "same-origin" });
    var draft = await draftResponse.json();
    if (!draftResponse.ok || !draft.ok) throw new Error(draft.error || "Draft unavailable");
    pendingDraft = draft.status === "pending" ? draft : null;
    acceptedRevision = result.revision;
    var shown = pendingDraft && pendingDraft.wireguard ? pendingDraft.wireguard : result.wireguard;
    document.getElementById("wireguard-list").innerHTML = (shown || []).length
      ? shown.map(function (tunnel) {
        return "<li>" + esc(tunnel.name) + " port " + esc(tunnel.listen_port || "auto") +
          " " + esc((tunnel.addresses || []).join(" ")) +
          (tunnel.private_key_set ? " private key set" : " private key missing") + "</li>";
      }).join("")
      : "<li>No WireGuard tunnels</li>";
    document.getElementById("wireguard-key").value = "";
    status.textContent = "Accepted revision " + result.revision;
    document.getElementById("wireguard-save-and-apply").disabled = !!pendingDraft || !!pendingApply;
    document.getElementById("wireguard-apply").disabled = !!pendingDraft || !!pendingApply;
  }

  function setupWireGuard() {
    var review = document.getElementById("wireguard-review-panel");
    var proposed = null;
    loadWireGuard().catch(function (error) {
      var result = document.getElementById("wireguard-result");
      if (result) result.textContent = "Could not load WireGuard: " + error.message;
    });
    document.getElementById("wireguard-review").addEventListener("click", function () {
      var tunnel = wireGuardTunnel();
      var problem = wireGuardProblem(tunnel);
      if (problem) {
        proposed = null;
        review.hidden = true;
        document.getElementById("wireguard-result").textContent = "Rejected: " + problem;
        return;
      }
      proposed = [tunnel];
      document.getElementById("wireguard-summary").textContent = wireGuardSummary(proposed[0]);
      review.hidden = false;
      document.getElementById("wireguard-result").textContent = "";
    });
    document.getElementById("wireguard-save-draft").addEventListener("click", async function (event) {
      if (!proposed) return;
      var button = event.currentTarget;
      button.disabled = true;
      try {
        var response = await fetch("/api/draft/save", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base_revision: pendingDraft ? pendingDraft.base_revision : acceptedRevision,
            version: pendingDraft ? pendingDraft.version : null,
            wireguard: proposed,
          }),
        });
        var result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Draft save failed");
        review.hidden = true;
        document.getElementById("wireguard-key").value = "";
        document.getElementById("wireguard-result").textContent =
          "Draft saved against Accepted revision " + result.base_revision + "; networking unchanged";
        await loadWireGuard();
        await loadRoutes();
      } catch (error) {
        document.getElementById("wireguard-result").textContent = "Draft save failed: " + error.message;
      } finally {
        button.disabled = false;
      }
    });
    async function applyTunnel(path, button) {
      var tunnel = path.indexOf("save-and-apply") >= 0 ? wireGuardTunnel() : null;
      var problem = tunnel ? wireGuardProblem(tunnel) : "";
      if (problem) {
        document.getElementById("wireguard-result").textContent = "Rejected: " + problem;
        return;
      }
      var tunnels = tunnel ? [tunnel] : proposed;
      if (!tunnels) return;
      button.disabled = true;
      try {
        var response = await fetch(path, {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base_revision: acceptedRevision, wireguard: tunnels }),
        });
        var result = await response.json();
        if (!response.ok || !result.ok) {
          document.getElementById("wireguard-result").textContent =
            (result.outcome === "rejected" ? "Rejected: " : "Apply failed: ") +
            (result.error || "WireGuard change unavailable") + recoveryText(result);
          return;
        }
        review.hidden = true;
        proposed = null;
        document.getElementById("wireguard-key").value = "";
        document.getElementById("wireguard-result").textContent = result.outcome === "pending_confirmation"
          ? "Revision " + result.revision + " is pending confirmation."
          : "Accepted revision " + result.revision;
        await loadWireGuard();
        await loadRoutes();
        await loadApplyConfirmation();
      } catch (_) {
        document.getElementById("wireguard-result").textContent =
          "Apply outcome unavailable; reload WireGuard before retrying.";
      } finally {
        button.disabled = false;
      }
    }
    document.getElementById("wireguard-apply").addEventListener("click", function (event) {
      if (pendingDraft || pendingApply) return;
      applyTunnel("/api/wireguard/apply", event.currentTarget);
    });
    document.getElementById("wireguard-save-and-apply").addEventListener("click", function (event) {
      if (pendingDraft || pendingApply) return;
      applyTunnel("/api/wireguard/save-and-apply", event.currentTarget);
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
      "<section><h3>Apply confirmation</h3>" +
      "<p id=\"apply-confirmation-status\"></p>" +
      "<form id=\"apply-confirmation-form\">" +
      "<input id=\"apply-confirmation-revision\" type=\"hidden\">" +
      "<label><input id=\"apply-confirmation-enabled\" type=\"checkbox\">Require confirmation after Apply</label>" +
      "<button type=\"submit\">Apply setting</button></form>" +
      "<p id=\"pending-apply-status\"></p>" +
      "<button id=\"review-apply\" type=\"button\" hidden>Review pending revision</button>" +
      "<div id=\"pending-apply-review\" hidden>" +
      "<h4 id=\"pending-apply-review-heading\"></h4>" +
      "<pre id=\"pending-apply-review-details\" style=\"white-space:pre-wrap;overflow-wrap:anywhere\"></pre>" +
      "<button id=\"confirm-reviewed-apply\" type=\"button\">Confirm reviewed revision</button></div>" +
      "<p id=\"last-apply-actors\"></p>" +
      "<p id=\"apply-confirmation-result\" role=\"status\"></p></section>" +
      "<h3>NICs</h3><ul>" +
      ifaces +
      "</ul>" +
      "<section><h3>Interfaces</h3>" +
      "<p id=\"accepted-interface-status\"></p>" +
      "<p id=\"interface-draft-note\"></p>" +
      "<div id=\"interface-rows\"></div>" +
      "<button id=\"interface-add-vlan\" type=\"button\">Add VLAN</button>" +
      "<button id=\"interface-review\" type=\"button\">Review interfaces</button>" +
      "<button id=\"interface-save-and-apply\" type=\"button\">Save and apply interfaces</button>" +
      "<div id=\"interface-review-panel\" hidden><h4>Review interface change</h4>" +
      "<p id=\"interface-summary\"></p>" +
      "<button id=\"interface-save-draft\" type=\"button\">Save interface draft</button>" +
      "<button id=\"interface-apply\" type=\"button\">Apply interface change</button>" +
      "<button id=\"interface-cancel-review\" type=\"button\">Cancel interface review</button></div>" +
      "<p id=\"interface-result\" role=\"status\"></p></section>" +
      "<section><h3>LAN services</h3>" +
      "<p id=\"accepted-service-status\"></p>" +
      "<p id=\"service-dns\"></p>" +
      "<p id=\"service-draft-note\"></p>" +
      "<form id=\"service-form\">" +
      "<label>LAN prefix <input id=\"service-prefix\" placeholder=\"192.168.1.0/24\"></label>" +
      "<label>DHCP pool <input id=\"service-pool\" placeholder=\"192.168.1.100-192.168.1.200\"></label>" +
      "<label>WAN prefix delegation <input id=\"service-pd\" placeholder=\"2001:db8:1::/56\"></label>" +
      "</form>" +
      "<button id=\"service-review\" type=\"button\">Review LAN services</button>" +
      "<button id=\"service-save-and-apply\" type=\"button\">Save and apply LAN services</button>" +
      "<div id=\"service-review-panel\" hidden><h4>Review LAN services</h4>" +
      "<p id=\"service-summary\"></p>" +
      "<button id=\"service-save-draft\" type=\"button\">Save LAN service draft</button>" +
      "<button id=\"service-apply\" type=\"button\">Apply LAN services</button></div>" +
      "<p id=\"service-result\" role=\"status\"></p></section>" +
      "<section><h3>Firewall policy</h3>" +
      "<p id=\"accepted-policy-status\"></p>" +
      "<ul id=\"policy-rules\"></ul>" +
      "<form id=\"policy-form\">" +
      "<label>Interface <select id=\"policy-interface\"></select></label>" +
      "<label>Source <input id=\"policy-source\" placeholder=\"10.56.0.2\"></label>" +
      "<label>Protocol <select id=\"policy-protocol\">" +
      "<option value=\"any\">any</option><option value=\"icmp\">icmp</option>" +
      "<option value=\"tcp\">tcp</option><option value=\"udp\">udp</option></select></label>" +
      "<label>Port <input id=\"policy-port\" inputmode=\"numeric\"></label>" +
      "<label>Action <select id=\"policy-action\"><option value=\"drop\">drop</option>" +
      "<option value=\"reject\">reject</option><option value=\"accept\">accept</option></select></label>" +
      "</form>" +
      "<button id=\"policy-review\" type=\"button\">Review firewall policy</button>" +
      "<button id=\"policy-save-and-apply\" type=\"button\">Save and apply firewall policy</button>" +
      "<div id=\"policy-review-panel\" hidden><h4>Review firewall policy</h4>" +
      "<p id=\"policy-summary\"></p>" +
      "<button id=\"policy-save-draft\" type=\"button\">Save firewall draft</button>" +
      "<button id=\"policy-apply\" type=\"button\">Apply firewall policy</button></div>" +
      "<p id=\"policy-result\" role=\"status\"></p></section>" +
      "<section><h3>WireGuard</h3>" +
      "<p id=\"accepted-wireguard-status\"></p>" +
      "<ul id=\"wireguard-list\"></ul>" +
      "<form id=\"wireguard-form\">" +
      "<label>Name <input id=\"wireguard-name\" value=\"wg0\"></label>" +
      "<label>Private key <input id=\"wireguard-key\" type=\"password\" autocomplete=\"off\"></label>" +
      "<label>Listen port <input id=\"wireguard-port\" inputmode=\"numeric\" placeholder=\"51820\"></label>" +
      "<label>Addresses <input id=\"wireguard-addresses\" placeholder=\"10.13.13.1/24\"></label>" +
      "<label>Route destination <input id=\"wireguard-route-to\" placeholder=\"198.51.100.0/24\"></label>" +
      "<label>Route next hop <input id=\"wireguard-route-via\" placeholder=\"10.13.13.2\"></label>" +
      "</form>" +
      "<button id=\"wireguard-review\" type=\"button\">Review WireGuard</button>" +
      "<button id=\"wireguard-save-and-apply\" type=\"button\">Save and apply WireGuard</button>" +
      "<div id=\"wireguard-review-panel\" hidden><h4>Review WireGuard</h4>" +
      "<p id=\"wireguard-summary\"></p>" +
      "<button id=\"wireguard-save-draft\" type=\"button\">Save WireGuard draft</button>" +
      "<button id=\"wireguard-apply\" type=\"button\">Apply WireGuard</button></div>" +
      "<p id=\"wireguard-result\" role=\"status\"></p></section>" +
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
      "<button type=\"submit\">Review route</button>" +
      "<button id=\"route-cancel-edit\" type=\"button\">Cancel route edit</button></form>" +
      "<button id=\"route-save-and-apply\" type=\"button\">Save and apply</button>" +
      "<div id=\"route-review\" hidden><h4>Review route change</h4>" +
      "<p id=\"route-summary\"></p>" +
      "<button id=\"route-save-draft\" type=\"button\">Save draft</button>" +
      "<button id=\"route-apply\" type=\"button\">Apply route change</button>" +
      "<button id=\"route-remove-save-and-apply\" type=\"button\" hidden>Save and apply</button>" +
      "<button id=\"route-cancel-review\" type=\"button\">Cancel review</button></div>" +
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
    setupInterfaces();
    setupLanServices();
    setupPolicy();
    setupWireGuard();
    setupRoutes();
    setupApplyConfirmation();
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
