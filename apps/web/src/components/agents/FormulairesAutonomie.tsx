"use client";

import { useState, type FormEvent } from "react";
import type { NiveauAutonomie } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  libelleNiveau,
  lireBrique,
  lireDecisionAutonomie,
  lireIncident,
  lireMotif,
  messageAgents,
  niveauxDecidables,
} from "../../lib/agents";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

/*
 * Formulaires de l'autonomie (AGT-03) : déclaration d'une brique (agent.gerer), décision
 * d'un associé (autonomie.decider), signalement d'un incident (agent.lire) et coupe-circuit
 * N4. Les règles (paliers, éligibilité, rétrogradation) sont appliquées par l'API ; l'écran
 * ne fait que proposer les choix possibles et relayer ses refus.
 */

const NIVEAUX: NiveauAutonomie[] = ["N0", "N1", "N2", "N3", "N4"];

export function FormulaireBrique({ agents }: { agents: { code: string; nom: string }[] }) {
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
    const ok = await f.envoyer(lireBrique(s), (c) => api.post("/api/agents/briques", c), {
      succes: "Brique confiée à l'agent, au niveau N2 au plus.",
      messageSpecifique: messageAgents,
    });
    if (ok) setS((x) => ({ ...x, brique_code: "" }));
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle="Code de la brique"
          aide="Code du référentiel de méthodes, par exemple « rapport.avancement »."
          required
          maxLength={120}
          value={s.brique_code}
          onChange={(e) => maj("brique_code")(e.target.value)}
          erreur={f.erreurs.brique_code}
        />
        <Select
          libelle="Agent"
          required
          invite="Choisir un agent…"
          value={s.agent_code}
          onChange={(e) => maj("agent_code")(e.target.value)}
          options={agents.map((a) => ({ valeur: a.code, libelle: a.nom }))}
          erreur={f.erreurs.agent_code}
        />
        <Select
          libelle="Classe de risque"
          required
          value={s.classe_risque}
          onChange={(e) => maj("classe_risque")(e.target.value)}
          options={[
            { valeur: "R0", libelle: "R0 — Opérationnel interne" },
            { valeur: "R1", libelle: "R1 — Analyse interne" },
            { valeur: "R2", libelle: "R2 — Livrable client" },
            { valeur: "R3", libelle: "R3 — Engageant" },
          ]}
          erreur={f.erreurs.classe_risque}
        />
        <Select
          libelle="Niveau d'autonomie maximal"
          aide="N4 seulement pour une brique R0."
          required
          value={s.niveau_max}
          onChange={(e) => maj("niveau_max")(e.target.value)}
          options={NIVEAUX.map((n) => ({ valeur: n, libelle: libelleNiveau(n) }))}
          erreur={f.erreurs.niveau_max}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Confier la brique
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
  const f = useFormulaire<"niveau" | "motif">();
  const choix = niveauxDecidables(accorde, plafond);
  const [niveau, setNiveau] = useState("");
  const [motif, setMotif] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      lireDecisionAutonomie({ niveau, motif }),
      (c) => api.post(`/api/agents/briques/${encodeURIComponent(code)}/decisions`, c),
      { succes: "Décision enregistrée et journalisée.", messageSpecifique: messageAgents },
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
        libelle="Nouveau niveau accordé"
        aide="Une hausse se fait d'un palier ; N3 et N4 exigent l'éligibilité calculée."
        required
        invite="Choisir un niveau…"
        value={niveau}
        onChange={(e) => setNiveau(e.target.value)}
        options={choix.map((n) => ({ valeur: n, libelle: libelleNiveau(n) }))}
        erreur={f.erreurs.niveau}
      />
      <ZoneTexte
        libelle="Motif de la décision"
        required
        maxLength={2000}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer la décision
        </Bouton>
      </div>
    </form>
  );
}

export function FormulaireIncident({ code }: { code: string }) {
  const f = useFormulaire<"gravite" | "description">();
  const [gravite, setGravite] = useState("");
  const [description, setDescription] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      lireIncident({ gravite, description }),
      (c) =>
        api.post<{ retrograde: boolean }>(
          `/api/agents/briques/${encodeURIComponent(code)}/incidents`,
          c,
        ),
      {
        succes:
          gravite === "majeur"
            ? "Incident majeur signalé : une brique en N3 ou N4 repasse en N2."
            : "Incident signalé.",
        messageSpecifique: messageAgents,
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
        libelle="Gravité"
        required
        invite="Choisir…"
        value={gravite}
        onChange={(e) => setGravite(e.target.value)}
        options={[
          { valeur: "mineur", libelle: "Mineur (compté, sans effet immédiat)" },
          { valeur: "majeur", libelle: "Majeur (rétrogradation automatique en N2)" },
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
        <Bouton type="submit" variante="secondaire" chargement={f.enCours} texteChargement="Envoi…">
          Signaler l&apos;incident
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
  const f = useFormulaire<"motif">();
  const [motif, setMotif] = useState("");
  const autorise = actif ? peutLever : peutCouper;
  if (!autorise) {
    return (
      <p className="mp-texte-doux mp-texte-petit">
        {actif
          ? "Seul un associé peut lever le coupe-circuit."
          : "Couper N4 relève d'un expert métier ou d'un associé."}
      </p>
    );
  }

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      lireMotif(motif),
      (c) => api.put("/api/agents/coupe-circuit", { actif: !actif, motif: c.motif }),
      {
        succes: actif ? "Coupe-circuit levé." : "Coupe-circuit activé : plus aucune exécution N4.",
        messageSpecifique: messageAgents,
      },
    );
    if (ok) setMotif("");
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <ZoneTexte
        libelle="Motif"
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
          texteChargement="Enregistrement…"
        >
          {actif ? "Lever le coupe-circuit" : "Couper l'exécution N4"}
        </Bouton>
      </div>
    </form>
  );
}
