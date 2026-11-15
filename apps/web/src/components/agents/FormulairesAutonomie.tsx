"use client";

import { useState, type FormEvent } from "react";
import type { NiveauAutonomie } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  libelleClasse,
  libelleNiveau,
  lireBrique,
  lireDecisionAutonomie,
  lireIncident,
  lireMotif,
  messageAgents,
  niveauxDecidables,
} from "../../lib/agents";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

/*
 * Formulaires de l'autonomie (AGT-03) : déclaration d'une brique (agent.gerer ; R0 par un
 * associé), décision d'un associé (autonomie.decider), signalement d'un incident (agent.lire ;
 * majeur : agent.gerer ou autonomie.decider) et coupe-circuit
 * N4. Les règles (paliers, éligibilité, rétrogradation) sont appliquées par l'API ; l'écran
 * ne fait que proposer les choix possibles et relayer ses refus.
 */

const NIVEAUX: NiveauAutonomie[] = ["N0", "N1", "N2", "N3", "N4"];

export function FormulaireBrique({
  agents,
  r0 = false,
}: {
  agents: { code: string; nom: string }[];
  /** Classe R0 proposée (associé seulement). */
  r0?: boolean;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"brique_code" | "agent_code" | "classe_risque" | "niveau_max">();
  const [s, setS] = useState({
    brique_code: "",
    agent_code: "",
    classe_risque: "R2",
    niveau_max: "N2",
  });
  const maj = (k: keyof typeof s) => (v: string) => setS((x) => ({ ...x, [k]: v }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(lireBrique(s, langue), (c) => api.post("/api/agents/briques", c), {
      succes: t(
        "Brique confiée à l'agent, au niveau N2 au plus.",
        "Building block assigned to the agent, at level N2 at most.",
      ),
      messageSpecifique: (e) => messageAgents(e, langue),
    });
    if (ok) setS((x) => ({ ...x, brique_code: "" }));
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Code de la brique", "Building block code")}
          aide={t(
            "Code du référentiel de méthodes, par exemple « rapport.avancement ».",
            'Code from the method framework, for example "rapport.avancement".',
          )}
          required
          maxLength={120}
          value={s.brique_code}
          onChange={(e) => maj("brique_code")(e.target.value)}
          erreur={f.erreurs.brique_code}
        />
        <Select
          libelle={t("Agent", "Agent")}
          required
          invite={t("Choisir un agent…", "Choose an agent…")}
          value={s.agent_code}
          onChange={(e) => maj("agent_code")(e.target.value)}
          options={agents.map((a) => ({ valeur: a.code, libelle: a.nom }))}
          erreur={f.erreurs.agent_code}
        />
        <Select
          libelle={t("Classe de risque", "Risk class")}
          required
          value={s.classe_risque}
          onChange={(e) => maj("classe_risque")(e.target.value)}
          options={[
            ...(r0 ? [{ valeur: "R0", libelle: libelleClasse("R0", langue) }] : []),
            { valeur: "R1", libelle: libelleClasse("R1", langue) },
            { valeur: "R2", libelle: libelleClasse("R2", langue) },
            { valeur: "R3", libelle: libelleClasse("R3", langue) },
          ]}
          erreur={f.erreurs.classe_risque}
        />
        <Select
          libelle={t("Niveau d'autonomie maximal", "Maximum autonomy level")}
          aide={t("N4 seulement pour une brique R0.", "N4 only for an R0 building block.")}
          required
          value={s.niveau_max}
          onChange={(e) => maj("niveau_max")(e.target.value)}
          options={NIVEAUX.map((n) => ({ valeur: n, libelle: libelleNiveau(n, langue) }))}
          erreur={f.erreurs.niveau_max}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Confier la brique", "Assign the building block")}
        </Bouton>
      </div>
    </form>
  );
}

export function FormulaireDecisionAutonomie({
  code,
  accorde,
  plafond,
}: {
  code: string;
  accorde: NiveauAutonomie;
  plafond: NiveauAutonomie;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"niveau" | "motif">();
  const choix = niveauxDecidables(accorde, plafond);
  const [niveau, setNiveau] = useState("");
  const [motif, setMotif] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      lireDecisionAutonomie({ niveau, motif }, langue),
      (c) => api.post(`/api/agents/briques/${encodeURIComponent(code)}/decisions`, c),
      {
        succes: t("Décision enregistrée et journalisée.", "Decision saved and logged."),
        messageSpecifique: (e) => messageAgents(e, langue),
      },
    );
    if (ok) {
      setNiveau("");
      setMotif("");
    }
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <Select
        libelle={t("Nouveau niveau accordé", "New level granted")}
        aide={t(
          "Une hausse se fait d'un palier ; N3 et N4 exigent l'éligibilité calculée.",
          "A raise goes up one step at a time; N3 and N4 require the computed eligibility.",
        )}
        required
        invite={t("Choisir un niveau…", "Choose a level…")}
        value={niveau}
        onChange={(e) => setNiveau(e.target.value)}
        options={choix.map((n) => ({ valeur: n, libelle: libelleNiveau(n, langue) }))}
        erreur={f.erreurs.niveau}
      />
      <ZoneTexte
        libelle={t("Motif de la décision", "Reason for the decision")}
        required
        maxLength={2000}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer la décision", "Save the decision")}
        </Bouton>
      </div>
    </form>
  );
}

export function FormulaireIncident({ code, majeur }: { code: string; majeur: boolean }) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"gravite" | "description">();
  const [gravite, setGravite] = useState("");
  const [description, setDescription] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      lireIncident({ gravite, description }, langue),
      (c) =>
        api.post<{ retrograde: boolean }>(
          `/api/agents/briques/${encodeURIComponent(code)}/incidents`,
          c,
        ),
      {
        succes:
          gravite === "majeur"
            ? t(
                "Incident majeur signalé : une brique en N3 ou N4 repasse en N2.",
                "Major incident reported: a building block at N3 or N4 goes back to N2.",
              )
            : t("Incident signalé.", "Incident reported."),
        messageSpecifique: (e) => messageAgents(e, langue),
      },
    );
    if (ok) {
      setGravite("");
      setDescription("");
    }
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <Select
        libelle={t("Gravité", "Severity")}
        required
        invite={t("Choisir…", "Choose…")}
        value={gravite}
        onChange={(e) => setGravite(e.target.value)}
        options={[
          {
            valeur: "mineur",
            libelle: t(
              "Mineur (compté, sans effet immédiat)",
              "Minor (counted, no immediate effect)",
            ),
          },
          ...(majeur
            ? [
                {
                  valeur: "majeur",
                  libelle: t(
                    "Majeur (rétrogradation automatique en N2)",
                    "Major (automatic demotion to N2)",
                  ),
                },
              ]
            : []),
        ]}
        erreur={f.erreurs.gravite}
      />
      <ZoneTexte
        libelle="Description"
        required
        maxLength={2000}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        erreur={f.erreurs.description}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          chargement={f.enCours}
          texteChargement={t("Envoi…", "Sending…")}
        >
          {t("Signaler l'incident", "Report the incident")}
        </Bouton>
      </div>
    </form>
  );
}

export function FormulaireCoupeCircuit({
  actif,
  peutCouper,
  peutLever,
}: {
  actif: boolean;
  peutCouper: boolean;
  peutLever: boolean;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"motif">();
  const [motif, setMotif] = useState("");
  const autorise = actif ? peutLever : peutCouper;
  if (!autorise) {
    return (
      <p className="mp-texte-doux mp-texte-petit">
        {actif
          ? t(
              "Seul un associé peut lever le coupe-circuit.",
              "Only a partner can lift the circuit breaker.",
            )
          : t(
              "Couper N4 relève d'un expert métier ou d'un associé.",
              "Cutting N4 is up to a subject-matter expert or a partner.",
            )}
      </p>
    );
  }

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      lireMotif(motif, 1000, langue),
      (c) => api.put("/api/agents/coupe-circuit", { actif: !actif, motif: c.motif }),
      {
        succes: actif
          ? t("Coupe-circuit levé.", "Circuit breaker lifted.")
          : t(
              "Coupe-circuit activé : plus aucune exécution N4.",
              "Circuit breaker on: no more N4 executions.",
            ),
        messageSpecifique: (e) => messageAgents(e, langue),
      },
    );
    if (ok) setMotif("");
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <ZoneTexte
        libelle={t("Motif", "Reason")}
        required
        maxLength={1000}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante={actif ? "secondaire" : "danger"}
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {actif
            ? t("Lever le coupe-circuit", "Lift the circuit breaker")
            : t("Couper l'exécution N4", "Cut N4 execution")}
        </Bouton>
      </div>
    </form>
  );
}
