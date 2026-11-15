"use client";

import { useState, type FormEvent } from "react";
import {
  TYPES_FACTEUR_CONTEXTE,
  type Langue,
  type TypeFacteurContexte,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  construireFacteur,
  messageMethodes,
  saisieFacteurVide,
  type ChampFacteur,
  type SaisieFacteur,
} from "../../lib/methodes";
import type { Resultat } from "../../lib/saisie";
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
const TYPE_LIBELLES_EN: Record<TypeFacteurContexte, string> = {
  booleen: "Yes / no",
  nombre: "Number",
  enumeration: "One value from a list",
  liste: "Several values from a list",
};
const libelleTypeFacteur = (t: TypeFacteurContexte, langue: Langue) =>
  (langue === "en" ? TYPE_LIBELLES_EN : TYPE_LIBELLES)[t];

/** Facteur de contexte propre au cabinet (STD-04), sans écraser un code du standard. */
export function FormulaireFacteur() {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampFacteur>();
  const [s, setS] = useState<SaisieFacteur>(saisieFacteurVide());

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      construireFacteur(s, langue),
      (c) => api.post("/api/standard/facteurs", c),
      {
        succes: t(
          "Facteur ajouté au dictionnaire du cabinet.",
          "Factor added to the firm's dictionary.",
        ),
        messageSpecifique: (e) => messageMethodes(e, langue),
      },
    );
    if (ok) setS(saisieFacteurVide());
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Libellé", "Label")}
          required
          value={s.libelle}
          maxLength={200}
          onChange={(e) => setS({ ...s, libelle: e.target.value })}
          erreur={f.erreurs.libelle}
        />
        <Champ
          libelle={t("Code", "Code")}
          required
          value={s.code}
          maxLength={120}
          spellCheck={false}
          onChange={(e) => setS({ ...s, code: e.target.value })}
          erreur={f.erreurs.code}
        />
        <Select
          libelle={t("Type", "Type")}
          value={s.type}
          onChange={(e) => setS({ ...s, type: e.target.value as TypeFacteurContexte })}
          options={TYPES_FACTEUR_CONTEXTE.map((te) => ({
            valeur: te,
            libelle: libelleTypeFacteur(te, langue),
          }))}
        />
        <Select
          libelle={t("Porté par", "Carried by")}
          value={s.porte_par}
          onChange={(e) => setS({ ...s, porte_par: e.target.value as SaisieFacteur["porte_par"] })}
          options={[
            { valeur: "mission", libelle: t("La mission", "The engagement") },
            { valeur: "dossier", libelle: t("Le dossier client", "The client file") },
          ]}
        />
      </div>
      {s.type === "enumeration" || s.type === "liste" ? (
        <ZoneTexte
          libelle={t("Valeurs permises", "Allowed values")}
          required
          rows={4}
          value={s.valeurs}
          onChange={(e) => setS({ ...s, valeurs: e.target.value })}
          erreur={f.erreurs.valeurs}
          aide={t(
            "Une par ligne : « code : libellé », ex. « bio : Certifiée bio ».",
            'One per line: "code: label", e.g. "bio: Certified organic".',
          )}
        />
      ) : null}
      {s.type === "nombre" ? (
        <div className="mp-grille-champs">
          <Champ
            libelle={t("Minimum", "Minimum")}
            inputMode="decimal"
            value={s.min}
            onChange={(e) => setS({ ...s, min: e.target.value })}
            erreur={f.erreurs.min}
          />
          <Champ
            libelle={t("Maximum", "Maximum")}
            inputMode="decimal"
            value={s.max}
            onChange={(e) => setS({ ...s, max: e.target.value })}
            erreur={f.erreurs.max}
          />
        </div>
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone="plus"
          chargement={f.enCours}
          texteChargement={t("Ajout…", "Adding…")}
        >
          {t("Ajouter le facteur", "Add the factor")}
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
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampProposition>();
  const [methodeId, setMethodeId] = useState("");
  const [titre, setTitre] = useState("");
  const [description, setDescription] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const erreurs: Partial<Record<ChampProposition, string>> = {};
    if (!titre.trim()) erreurs.titre = t("Titre obligatoire.", "Title required.");
    if (!description.trim()) {
      erreurs.description = t("Décrire l'évolution proposée.", "Describe the proposed change.");
    }
    const charge = {
      methode_id: methodeId || null,
      titre: titre.trim(),
      description: description.trim(),
    };
    const validation: Resultat<typeof charge, ChampProposition> =
      Object.keys(erreurs).length > 0 ? { ok: false, erreurs } : { ok: true, charge };
    const ok = await f.envoyer(validation, (c) => api.post("/api/standard/propositions", c), {
      succes: t(
        "Proposition soumise au comité méthode.",
        "Proposal submitted to the method committee.",
      ),
      messageSpecifique: (e) => messageMethodes(e, langue),
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
          libelle={t("Méthode visée", "Target method")}
          value={methodeId}
          onChange={(e) => setMethodeId(e.target.value)}
          invite={t("Nouvelle méthode", "New method")}
          options={methodes.map((m) => ({ valeur: m.id, libelle: m.libelle }))}
        />
        <Champ
          libelle={t("Titre", "Title")}
          required
          value={titre}
          maxLength={200}
          onChange={(e) => setTitre(e.target.value)}
          erreur={f.erreurs.titre}
        />
      </div>
      <ZoneTexte
        libelle={t("Description et justification", "Description and rationale")}
        required
        rows={4}
        maxLength={4000}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        erreur={f.erreurs.description}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone="envoyer"
          chargement={f.enCours}
          texteChargement={t("Envoi…", "Sending…")}
        >
          {t("Proposer", "Propose")}
        </Bouton>
      </div>
    </form>
  );
}

/** Décision du relecteur : accepter, ou refuser avec avis (l'auteur ne relit pas). */
export function DecisionProposition({ propositionId }: { propositionId: string }) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"avis">();
  const [avis, setAvis] = useState("");

  async function decider(action: "accepter" | "refuser") {
    const validation: Resultat<{ action: string; avis: string | null }, "avis"> =
      action === "refuser" && !avis.trim()
        ? { ok: false, erreurs: { avis: t("Motiver le refus.", "Give a reason for the refusal.") } }
        : { ok: true, charge: { action, avis: avis.trim() || null } };
    await f.envoyer(
      validation,
      (c) => api.post(`/api/standard/propositions/${propositionId}/revue`, c),
      {
        succes:
          action === "accepter"
            ? t("Proposition acceptée.", "Proposal accepted.")
            : t("Proposition refusée.", "Proposal refused."),
        messageSpecifique: (e) => messageMethodes(e, langue),
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
        libelle={t("Avis du relecteur", "Reviewer's opinion")}
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
          {t("Accepter", "Accept")}
        </Bouton>
        <Bouton
          type="button"
          variante="danger"
          disabled={f.enCours}
          onClick={() => void decider("refuser")}
        >
          {t("Refuser", "Refuse")}
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
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"version">();
  const [versionId, setVersionId] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      versionId
        ? { ok: true, charge: { version_id: versionId } }
        : { ok: false, erreurs: { version: t("Choisir la version.", "Choose the version.") } },
      (c) => api.post(`/api/standard/propositions/${propositionId}/publication`, c),
      {
        succes: t("Proposition publiée.", "Proposal published."),
        messageSpecifique: (e) => messageMethodes(e, langue),
      },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <Select
        libelle={t(
          "Version publiée qui porte l'évolution",
          "Published version carrying the change",
        )}
        value={versionId}
        onChange={(e) => setVersionId(e.target.value)}
        invite={t("Choisir…", "Choose…")}
        options={versions.map((v) => ({ valeur: v.id, libelle: v.libelle }))}
        erreur={f.erreurs.version}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          chargement={f.enCours}
          texteChargement={t("Publication…", "Publishing…")}
        >
          {t("Marquer publiée", "Mark as published")}
        </Bouton>
      </div>
    </form>
  );
}
