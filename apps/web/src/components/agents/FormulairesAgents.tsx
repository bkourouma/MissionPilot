"use client";

import { useState, type FormEvent } from "react";
import type { NiveauAutonomie } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { libelleNiveau, lireJeuEssai, lireMotif, messageAgents } from "../../lib/agents";
import type { Resultat } from "../../lib/saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

/*
 * Formulaires du registre et des évaluations : restriction d'un agent par le cabinet (on ne
 * peut que restreindre), jeu d'essai d'un prompt (cas en JSON), lancement d'une évaluation
 * de non-régression (fournisseur local déterministe).
 */

const NIVEAUX: NiveauAutonomie[] = ["N0", "N1", "N2", "N3", "N4"];

export function FormulaireRestriction({
  code,
  actif,
  standard,
  cabinet,
}: {
  code: string;
  actif: boolean;
  standard: NiveauAutonomie;
  cabinet: NiveauAutonomie | null;
}) {
  const f = useFormulaire<"motif">();
  const [etat, setEtat] = useState(actif ? "actif" : "inactif");
  const [niveau, setNiveau] = useState(cabinet ?? "");
  const [motif, setMotif] = useState("");
  const niveaux = NIVEAUX.filter((n) => NIVEAUX.indexOf(n) <= NIVEAUX.indexOf(standard));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      lireMotif(motif),
      (c) =>
        api.put(`/api/agents/${code}/restriction`, {
          actif: etat === "actif",
          niveau_max: niveau === "" ? null : niveau,
          motif: c.motif,
        }),
      { succes: "Restriction enregistrée.", messageSpecifique: messageAgents },
    );
    if (ok) setMotif("");
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Select
          libelle="État pour le cabinet"
          value={etat}
          onChange={(e) => setEtat(e.target.value)}
          options={[
            { valeur: "actif", libelle: "Actif" },
            { valeur: "inactif", libelle: "Désactivé (niveau N0)" },
          ]}
        />
        <Select
          libelle="Niveau maximal du cabinet"
          value={niveau}
          onChange={(e) => setNiveau(e.target.value)}
          options={[
            { valeur: "", libelle: `Celui du standard (${standard})` },
            ...niveaux.map((n) => ({ valeur: n, libelle: libelleNiveau(n) })),
          ]}
        />
      </div>
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
          variante="secondaire"
          chargement={f.enCours}
          texteChargement="Enregistrement…"
        >
          Enregistrer la restriction
        </Bouton>
      </div>
    </form>
  );
}

const EXEMPLE_CAS = JSON.stringify(
  [
    {
      code: "cas_1",
      variables: { texte: "Le climat social est bon. Les équipes sont motivées." },
      attendu: { contient: ["climat"] },
    },
  ],
  null,
  2,
);

export function FormulaireJeuEssai() {
  const f = useFormulaire<"prompt_nom" | "cas">();
  const [s, setS] = useState({ prompt_nom: "", description: "", cas: EXEMPLE_CAS });

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(lireJeuEssai(s), (c) => api.post("/api/agents/jeux-essai", c), {
      succes: "Jeu d'essai enregistré : il s'applique à toute nouvelle version du prompt.",
      messageSpecifique: messageAgents,
    });
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle="Nom du prompt"
          required
          maxLength={60}
          value={s.prompt_nom}
          onChange={(e) => setS((x) => ({ ...x, prompt_nom: e.target.value }))}
          erreur={f.erreurs.prompt_nom}
        />
        <Champ
          libelle="Description"
          maxLength={1000}
          value={s.description}
          onChange={(e) => setS((x) => ({ ...x, description: e.target.value }))}
        />
      </div>
      <ZoneTexte
        libelle="Cas d'essai (JSON)"
        aide="Chaque cas : un code, les variables du prompt, les chiffres qu'un moteur fournirait, et des critères (contient, ne_contient_pas, champs)."
        required
        rows={10}
        value={s.cas}
        onChange={(e) => setS((x) => ({ ...x, cas: e.target.value }))}
        erreur={f.erreurs.cas}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer le jeu d&apos;essai
        </Bouton>
      </div>
    </form>
  );
}

export function FormulaireEvaluation({
  versions,
}: {
  versions: { id: string; libelle: string }[];
}) {
  const f = useFormulaire<"prompt_id" | "modele">();
  const [promptId, setPromptId] = useState("");
  const [modele, setModele] = useState("");

  function lire(): Resultat<{ prompt_id: string; modele?: string }, "prompt_id" | "modele"> {
    if (promptId === "") return { ok: false, erreurs: { prompt_id: "Choisissez une version." } };
    const m = modele.trim();
    if (m !== "" && !/^[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,99}$/.test(m)) {
      return { ok: false, erreurs: { modele: "Format attendu : « fournisseur/modèle »." } };
    }
    return {
      ok: true,
      charge: m === "" ? { prompt_id: promptId } : { prompt_id: promptId, modele: m },
    };
  }

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(lire(), (c) => api.post("/api/agents/evaluations", c), {
      succes: "Évaluation terminée : voir son résultat ci-dessous.",
      messageSpecifique: messageAgents,
    });
  }

  if (versions.length === 0) {
    return <p className="mp-texte-doux">Aucun prompt doté d&apos;un jeu d&apos;essai à évaluer.</p>;
  }
  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Select
          libelle="Version du prompt à évaluer"
          required
          invite="Choisir…"
          value={promptId}
          onChange={(e) => setPromptId(e.target.value)}
          options={versions.map((v) => ({ valeur: v.id, libelle: v.libelle }))}
          erreur={f.erreurs.prompt_id}
        />
        <Champ
          libelle="Modèle candidat (facultatif)"
          aide="Par défaut, le modèle de la tâche."
          maxLength={170}
          value={modele}
          onChange={(e) => setModele(e.target.value)}
          erreur={f.erreurs.modele}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Évaluation…">
          Lancer l&apos;évaluation
        </Bouton>
      </div>
    </form>
  );
}
