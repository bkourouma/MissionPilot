"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { TYPES_SOURCE_PREUVE } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminPreuvesMission,
  cheminVersionsPreuve,
  FIABILITES,
  hrefPreuve,
  messagePreuves,
  TYPE_SOURCE_LIBELLES,
  type DetailPreuve,
  type DimensionVue,
  type PreuveVue,
} from "../../lib/preuves";
import {
  EXTRAIT_MAX,
  MOTIF_PREUVE_MAX,
  saisiePreuveVide,
  SOURCE_MAX,
  validerPreuve,
  type ChampPreuve,
  type SaisiePreuve,
  type TypeLienPreuve,
} from "../../lib/preuves-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

const OPTIONS_TYPE = TYPES_SOURCE_PREUVE.map((t) => ({
  valeur: t,
  libelle: TYPE_SOURCE_LIBELLES[t],
}));
const OPTIONS_FIABILITE = (["A", "B", "C", "D"] as const).map((f) => ({
  valeur: f,
  libelle: FIABILITES[f],
}));
const OPTIONS_LIEN: { valeur: TypeLienPreuve; libelle: string }[] = [
  { valeur: "aucun", libelle: "Aucun" },
  { valeur: "document", libelle: "Document de la mission" },
  { valeur: "fichier", libelle: "Fichier téléversé" },
  { valeur: "reponse", libelle: "Réponse de questionnaire" },
];

function saisieDepuis(p: PreuveVue): SaisiePreuve {
  const lien: { lien_type: TypeLienPreuve; lien_id: string } = p.document_id
    ? { lien_type: "document", lien_id: p.document_id }
    : p.fichier_id
      ? { lien_type: "fichier", lien_id: p.fichier_id }
      : p.reponse_id
        ? { lien_type: "reponse", lien_id: p.reponse_id }
        : { lien_type: "aucun", lien_id: "" };
  return {
    type_source: p.type_source,
    source_precise: p.source_precise,
    date_preuve: p.date_preuve,
    auteur_id: p.auteur.id,
    fiabilite: p.fiabilite,
    extrait: p.extrait ?? "",
    ...lien,
    dimensions: p.dimensions,
    nominatif: p.nominatif,
    accord_nominatif: p.accord_nominatif,
    motif: "",
  };
}

export interface FormulairePreuveProps {
  missionId: string;
  dimensions: readonly DimensionVue[];
  aujourdhui: string;
  /** Présente : correction de cette preuve (nouvelle version, motif exigé). */
  preuve?: PreuveVue;
}

/**
 * Enregistrement d'une preuve ou correction d'une preuve existante. Une preuve ne s'écrase
 * jamais : la correction crée une nouvelle version, l'ancienne reste consultable.
 */
export function FormulairePreuve({
  missionId,
  dimensions,
  aujourdhui,
  preuve,
}: FormulairePreuveProps) {
  const router = useRouter();
  const correction = preuve !== undefined;
  const f = useFormulaire<ChampPreuve>();
  const [s, setS] = useState<SaisiePreuve>(
    preuve && !preuve.masque ? saisieDepuis(preuve) : saisiePreuveVide(aujourdhui),
  );
  const maj = (partiel: Partial<SaisiePreuve>) => setS((x) => ({ ...x, ...partiel }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerPreuve(s, correction),
      (charge) =>
        correction
          ? api.post<DetailPreuve>(cheminVersionsPreuve(preuve.id), charge)
          : api.post<DetailPreuve>(cheminPreuvesMission(missionId), charge),
      {
        succes: correction
          ? "Nouvelle version enregistrée ; l'ancienne reste dans l'historique."
          : "Preuve enregistrée.",
        messageSpecifique: messagePreuves,
        apres: (r) => {
          if (!correction) router.push(hrefPreuve(missionId, r.id));
        },
      },
    );
  }

  const dimensionsActives = dimensions.filter((d) => d.actif || s.dimensions.includes(d.code));

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={correction ? "Corriger la preuve" : "Nouvelle preuve"}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Preuve refusée"
      />
      <div className="mp-grille-champs">
        <Select
          libelle="Type de source"
          required
          invite="Choisir…"
          options={OPTIONS_TYPE}
          value={s.type_source}
          onChange={(e) => maj({ type_source: e.target.value })}
          erreur={f.erreurs.type_source}
          aide="Les sources de types différents sont indépendantes : c'est ce qui fonde la triangulation."
        />
        <Select
          libelle="Fiabilité"
          required
          invite="Choisir…"
          options={OPTIONS_FIABILITE}
          value={s.fiabilite}
          onChange={(e) => maj({ fiabilite: e.target.value })}
          erreur={f.erreurs.fiabilite}
          aide="A : très fiable, D : peu fiable. À justifier dans le motif si elle change."
        />
      </div>
      <Champ
        libelle="Source précise"
        required
        maxLength={SOURCE_MAX}
        value={s.source_precise}
        onChange={(e) => maj({ source_precise: e.target.value })}
        erreur={f.erreurs.source_precise}
        aide="Qui, quoi, où : « Entretien avec la direction financière », « Rapport annuel 2025, p. 14 »."
      />
      <Champ
        libelle="Date de la preuve"
        type="date"
        required
        value={s.date_preuve}
        onChange={(e) => maj({ date_preuve: e.target.value })}
        erreur={f.erreurs.date_preuve}
      />
      <ZoneTexte
        libelle="Extrait"
        rows={4}
        maxLength={EXTRAIT_MAX}
        value={s.extrait}
        onChange={(e) => maj({ extrait: e.target.value })}
        erreur={f.erreurs.extrait}
        aide="Verbatim, donnée ou passage cité. Facultatif si la preuve est un fichier."
      />
      <div className="mp-grille-champs">
        <Select
          libelle="Lien vers un élément existant"
          options={OPTIONS_LIEN}
          value={s.lien_type}
          onChange={(e) => maj({ lien_type: e.target.value as TypeLienPreuve, lien_id: "" })}
          aide="Un seul lien par preuve."
        />
        {s.lien_type !== "aucun" ? (
          <Champ
            libelle="Identifiant de l'élément"
            autoComplete="off"
            value={s.lien_id}
            onChange={(e) => maj({ lien_id: e.target.value })}
            erreur={f.erreurs.lien_id}
            aide="Copiez l'identifiant depuis l'élément concerné."
          />
        ) : null}
      </div>
      {dimensionsActives.length > 0 ? (
        <fieldset className="mp-groupe-cases">
          <legend>Dimensions éclairées</legend>
          {dimensionsActives.map((d) => (
            <CaseACocher
              key={d.code}
              libelle={d.actif ? d.libelle : `${d.libelle} (désactivée)`}
              checked={s.dimensions.includes(d.code)}
              onChange={(e) =>
                maj({
                  dimensions: e.target.checked
                    ? [...s.dimensions, d.code]
                    : s.dimensions.filter((c) => c !== d.code),
                })
              }
            />
          ))}
          {f.erreurs.dimensions ? <p className="mp-champ__erreur">{f.erreurs.dimensions}</p> : null}
        </fieldset>
      ) : (
        <p className="mp-texte-doux">
          Aucune dimension n&apos;est déclarée pour cette mission : déclarez-les dans l&apos;onglet
          « Triangulation » pour rattacher les preuves.
        </p>
      )}
      <fieldset className="mp-groupe-cases">
        <legend>Verbatim nominatif</legend>
        <CaseACocher
          libelle="L'extrait identifie une personne"
          aide="Sans l'accord de la personne, l'extrait est masqué pour les membres de l'équipe qui ne l'ont pas recueilli."
          checked={s.nominatif}
          onChange={(e) =>
            maj({
              nominatif: e.target.checked,
              accord_nominatif: e.target.checked && s.accord_nominatif,
            })
          }
        />
        {s.nominatif ? (
          <CaseACocher
            libelle="La personne a donné son accord pour que l'extrait soit cité"
            checked={s.accord_nominatif}
            onChange={(e) => maj({ accord_nominatif: e.target.checked })}
          />
        ) : null}
      </fieldset>
      {correction ? (
        <ZoneTexte
          libelle="Motif de la correction"
          required
          rows={2}
          maxLength={MOTIF_PREUVE_MAX}
          value={s.motif}
          onChange={(e) => maj({ motif: e.target.value })}
          erreur={f.erreurs.motif}
          aide="Conservé dans l'historique. Corriger une preuve rouvre les contradictions qu'elle concerne."
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {correction ? "Enregistrer la nouvelle version" : "Enregistrer la preuve"}
        </Bouton>
      </div>
    </form>
  );
}
