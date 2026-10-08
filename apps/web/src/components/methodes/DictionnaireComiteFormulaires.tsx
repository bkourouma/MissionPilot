"use client";

import { useState, type FormEvent } from "react";
import { TYPES_FACTEUR_CONTEXTE, type TypeFacteurContexte } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  construireFacteur,
  messageMethodes,
  saisieFacteurVide,
  type ChampFacteur,
  type SaisieFacteur,
} from "../../lib/methodes";
import type { Resultat } from "../../lib/saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

const TYPE_LIBELLES: Record<TypeFacteurContexte, string> = {
  booleen: "Oui / non",
  nombre: "Nombre",
  enumeration: "Une valeur parmi une liste",
  liste: "Plusieurs valeurs d'une liste",
};

/** Facteur de contexte propre au cabinet (STD-04), sans écraser un code du standard. */
export function FormulaireFacteur() {
  const f = useFormulaire<ChampFacteur>();
  const [s, setS] = useState<SaisieFacteur>(saisieFacteurVide());

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(construireFacteur(s), (c) => api.post("/api/standard/facteurs", c), {
      succes: "Facteur ajouté au dictionnaire du cabinet.",
      messageSpecifique: messageMethodes,
    });
    if (ok) setS(saisieFacteurVide());
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle="Libellé"
          required
          value={s.libelle}
          maxLength={200}
          onChange={(e) => setS({ ...s, libelle: e.target.value })}
          erreur={f.erreurs.libelle}
        />
        <Champ
          libelle="Code"
          required
          value={s.code}
          maxLength={120}
          spellCheck={false}
          onChange={(e) => setS({ ...s, code: e.target.value })}
          erreur={f.erreurs.code}
        />
        <Select
          libelle="Type"
          value={s.type}
          onChange={(e) => setS({ ...s, type: e.target.value as TypeFacteurContexte })}
          options={TYPES_FACTEUR_CONTEXTE.map((t) => ({ valeur: t, libelle: TYPE_LIBELLES[t] }))}
        />
        <Select
          libelle="Porté par"
          value={s.porte_par}
          onChange={(e) => setS({ ...s, porte_par: e.target.value as SaisieFacteur["porte_par"] })}
          options={[
            { valeur: "mission", libelle: "La mission" },
            { valeur: "dossier", libelle: "Le dossier client" },
          ]}
        />
      </div>
      {s.type === "enumeration" || s.type === "liste" ? (
        <ZoneTexte
          libelle="Valeurs permises"
          required
          rows={4}
          value={s.valeurs}
          onChange={(e) => setS({ ...s, valeurs: e.target.value })}
          erreur={f.erreurs.valeurs}
          aide="Une par ligne : « code : libellé », ex. « bio : Certifiée bio »."
        />
      ) : null}
      {s.type === "nombre" ? (
        <div className="mp-grille-champs">
          <Champ
            libelle="Minimum"
            inputMode="decimal"
            value={s.min}
            onChange={(e) => setS({ ...s, min: e.target.value })}
            erreur={f.erreurs.min}
          />
          <Champ
            libelle="Maximum"
            inputMode="decimal"
            value={s.max}
            onChange={(e) => setS({ ...s, max: e.target.value })}
            erreur={f.erreurs.max}
          />
        </div>
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" icone="plus" chargement={f.enCours} texteChargement="Ajout…">
          Ajouter le facteur
        </Bouton>
      </div>
    </form>
  );
}

type ChampProposition = "titre" | "description";

/** Proposition d'évolution du référentiel au comité méthode (STD-12). */
export function FormulaireProposition({
  methodes,
}: {
  methodes: { id: string; libelle: string }[];
}) {
  const f = useFormulaire<ChampProposition>();
  const [methodeId, setMethodeId] = useState("");
  const [titre, setTitre] = useState("");
  const [description, setDescription] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const erreurs: Partial<Record<ChampProposition, string>> = {};
    if (!titre.trim()) erreurs.titre = "Titre obligatoire.";
    if (!description.trim()) erreurs.description = "Décrire l'évolution proposée.";
    const charge = {
      methode_id: methodeId || null,
      titre: titre.trim(),
      description: description.trim(),
    };
    const validation: Resultat<typeof charge, ChampProposition> =
      Object.keys(erreurs).length > 0 ? { ok: false, erreurs } : { ok: true, charge };
    const ok = await f.envoyer(validation, (c) => api.post("/api/standard/propositions", c), {
      succes: "Proposition soumise au comité méthode.",
      messageSpecifique: messageMethodes,
    });
    if (ok) {
      setTitre("");
      setDescription("");
    }
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Select
          libelle="Méthode visée"
          value={methodeId}
          onChange={(e) => setMethodeId(e.target.value)}
          invite="Nouvelle méthode"
          options={methodes.map((m) => ({ valeur: m.id, libelle: m.libelle }))}
        />
        <Champ
          libelle="Titre"
          required
          value={titre}
          maxLength={200}
          onChange={(e) => setTitre(e.target.value)}
          erreur={f.erreurs.titre}
        />
      </div>
      <ZoneTexte
        libelle="Description et justification"
        required
        rows={4}
        maxLength={4000}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        erreur={f.erreurs.description}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" icone="envoyer" chargement={f.enCours} texteChargement="Envoi…">
          Proposer
        </Bouton>
      </div>
    </form>
  );
}

/** Décision du relecteur : accepter, ou refuser avec avis (l'auteur ne relit pas). */
export function DecisionProposition({ propositionId }: { propositionId: string }) {
  const f = useFormulaire<"avis">();
  const [avis, setAvis] = useState("");

  async function decider(action: "accepter" | "refuser") {
    const validation: Resultat<{ action: string; avis: string | null }, "avis"> =
      action === "refuser" && !avis.trim()
        ? { ok: false, erreurs: { avis: "Motiver le refus." } }
        : { ok: true, charge: { action, avis: avis.trim() || null } };
    await f.envoyer(
      validation,
      (c) => api.post(`/api/standard/propositions/${propositionId}/revue`, c),
      {
        succes: action === "accepter" ? "Proposition acceptée." : "Proposition refusée.",
        messageSpecifique: messageMethodes,
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={(e) => e.preventDefault()}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <ZoneTexte
        libelle="Avis du relecteur"
        rows={2}
        maxLength={4000}
        value={avis}
        onChange={(e) => setAvis(e.target.value)}
        erreur={f.erreurs.avis}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="button"
          icone="succes"
          chargement={f.enCours}
          onClick={() => void decider("accepter")}
        >
          Accepter
        </Bouton>
        <Bouton
          type="button"
          variante="danger"
          disabled={f.enCours}
          onClick={() => void decider("refuser")}
        >
          Refuser
        </Bouton>
      </div>
    </form>
  );
}

/** Publication d'une proposition acceptée : version publiée du cabinet qui la porte. */
export function PublicationProposition({
  propositionId,
  versions,
}: {
  propositionId: string;
  versions: { id: string; libelle: string }[];
}) {
  const f = useFormulaire<"version">();
  const [versionId, setVersionId] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      versionId
        ? { ok: true, charge: { version_id: versionId } }
        : { ok: false, erreurs: { version: "Choisir la version." } },
      (c) => api.post(`/api/standard/propositions/${propositionId}/publication`, c),
      { succes: "Proposition publiée.", messageSpecifique: messageMethodes },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <Select
        libelle="Version publiée qui porte l'évolution"
        value={versionId}
        onChange={(e) => setVersionId(e.target.value)}
        invite="Choisir…"
        options={versions.map((v) => ({ valeur: v.id, libelle: v.libelle }))}
        erreur={f.erreurs.version}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          chargement={f.enCours}
          texteChargement="Publication…"
        >
          Marquer publiée
        </Bouton>
      </div>
    </form>
  );
}
