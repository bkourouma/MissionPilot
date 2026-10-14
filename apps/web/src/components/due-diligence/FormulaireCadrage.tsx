"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { TYPES_OPERATION_DD } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminCadrage,
  cheminDossiers,
  hrefDossier,
  messageDd,
  optionsDe,
  TYPE_OPERATION_DD_LIBELLES,
  type EntreeTaxonomie,
  type ReponseEcriture,
} from "../../lib/due-diligence";
import {
  saisieCadrageVide,
  validerCadrage,
  ENONCE_MAX,
  MOTIF_MAX,
  TEXTE_LONG_MAX,
  TITRE_MAX,
  type ChampCadrage,
  type SaisieCadrage,
} from "../../lib/due-diligence-saisie";
import { DEVISES } from "../../lib/format";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

const OPTIONS_TYPE = optionsDe(TYPES_OPERATION_DD, TYPE_OPERATION_DD_LIBELLES);
const OPTIONS_DEVISE = DEVISES.map((d) => ({
  valeur: d,
  libelle: d === "XOF" || d === "XAF" ? `${d} (FCFA)` : d,
}));

const optionsTaxonomie = (entrees: readonly EntreeTaxonomie[]) =>
  entrees.map((e) => ({ valeur: e.code, libelle: e.libelle }));

export interface FormulaireCadrageProps {
  missionId: string;
  secteurs: readonly EntreeTaxonomie[];
  filieres: readonly EntreeTaxonomie[];
  pays: readonly EntreeTaxonomie[];
  /** Devise proposée par défaut (celle de la mission). */
  devise: string;
  /** Présent : correction du cadrage du dossier (nouvelle version, motif exigé). */
  correction?: {
    dossierId: string;
    versionCourante: number;
    valeurs: Omit<SaisieCadrage, "motif">;
  };
}

/**
 * Cadrage d'une opération étudiée (DD-01) : secteur et filière, pays, cible, type d'opération,
 * devise, date d'opération prévue (nécessaire aux dates du plan des 100 jours), question et périmètre.
 * Création d'un dossier, ou correction motivée (version suivante).
 */
export function FormulaireCadrage({
  missionId,
  secteurs,
  filieres,
  pays,
  devise,
  correction,
}: FormulaireCadrageProps) {
  const router = useRouter();
  const f = useFormulaire<ChampCadrage>();
  const [s, setS] = useState<SaisieCadrage>(
    correction ? { ...correction.valeurs, motif: "" } : saisieCadrageVide(devise),
  );
  const maj = (partiel: Partial<SaisieCadrage>) => setS((x) => ({ ...x, ...partiel }));
  const taxonomiesAbsentes = secteurs.length === 0 || pays.length === 0;
  const filieresDuSecteur = filieres.filter((x) => x.parent_code === s.secteur_code);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerCadrage(s, correction !== undefined),
      (charge) =>
        correction
          ? api.post<ReponseEcriture>(cheminCadrage(correction.dossierId), {
              ...charge,
              version_courante: correction.versionCourante,
            })
          : api.post<ReponseEcriture>(cheminDossiers(missionId), charge),
      {
        succes: correction
          ? "Nouvelle version du cadrage enregistrée ; l'ancienne reste dans l'historique."
          : "Dossier créé.",
        messageSpecifique: messageDd,
        apres: (r) => {
          if (!correction && r.id) router.push(hrefDossier(missionId, r.id));
          else maj({ motif: "" });
        },
        rafraichir: correction !== undefined,
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={correction ? "Corriger le cadrage" : "Cadrage de l'opération"}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Cadrage refusé"
      />
      {taxonomiesAbsentes ? (
        <Alerte tonalite="attention" titre="Listes de choix incomplètes" annonce="aucune">
          <p>
            Les secteurs ou les pays n&apos;ont pas pu être chargés. Rechargez la page ; si le
            problème persiste, vérifiez que vous pouvez consulter le dictionnaire de données.
          </p>
        </Alerte>
      ) : null}
      <Champ
        libelle="Titre du dossier"
        required
        maxLength={TITRE_MAX}
        value={s.titre}
        onChange={(e) => maj({ titre: e.target.value })}
        erreur={f.erreurs.titre}
      />
      <div className="mp-grille-champs">
        <Select
          libelle="Secteur"
          required
          invite="Choisir…"
          options={optionsTaxonomie(secteurs)}
          value={s.secteur_code}
          onChange={(e) => maj({ secteur_code: e.target.value, filiere_code: "" })}
          erreur={f.erreurs.secteur_code}
        />
        <Select
          libelle="Filière"
          invite={
            s.secteur_code === "" ? "Choisissez d'abord le secteur" : "Aucune filière précise"
          }
          options={optionsTaxonomie(filieresDuSecteur)}
          value={s.filiere_code}
          onChange={(e) => maj({ filiere_code: e.target.value })}
          disabled={s.secteur_code === "" || filieresDuSecteur.length === 0}
          erreur={f.erreurs.filiere_code}
          aide={
            s.secteur_code !== "" && filieresDuSecteur.length === 0
              ? "Aucune filière n'est définie pour ce secteur."
              : undefined
          }
        />
        <Select
          libelle="Pays"
          required
          invite="Choisir…"
          options={optionsTaxonomie(pays)}
          value={s.pays_code}
          onChange={(e) => maj({ pays_code: e.target.value })}
          erreur={f.erreurs.pays_code}
        />
      </div>
      <div className="mp-grille-champs">
        <Select
          libelle="Type d'opération"
          required
          invite="Choisir…"
          options={OPTIONS_TYPE}
          value={s.type_operation}
          onChange={(e) => maj({ type_operation: e.target.value })}
          erreur={f.erreurs.type_operation}
        />
        <Champ
          libelle="Cible"
          required={s.type_operation === "acquisition"}
          maxLength={TITRE_MAX}
          value={s.cible_nom}
          onChange={(e) => maj({ cible_nom: e.target.value })}
          erreur={f.erreurs.cible_nom}
          aide={
            s.type_operation === "acquisition"
              ? "Obligatoire pour une acquisition."
              : "Facultatif : l'entreprise ou l'actif visé."
          }
        />
        <Select
          libelle="Devise du dossier"
          required
          options={OPTIONS_DEVISE}
          value={s.devise}
          onChange={(e) => maj({ devise: e.target.value })}
          erreur={f.erreurs.devise}
          aide="Les montants du marché sont saisis et affichés dans cette devise."
        />
        <Champ
          libelle="Date d'opération prévue"
          type="date"
          value={s.date_operation}
          onChange={(e) => maj({ date_operation: e.target.value })}
          erreur={f.erreurs.date_operation}
          aide="Facultative ; nécessaire pour dater les actions du plan des 100 jours."
        />
      </div>
      <ZoneTexte
        libelle="Question d'investissement"
        rows={3}
        maxLength={ENONCE_MAX}
        value={s.question_investissement}
        onChange={(e) => maj({ question_investissement: e.target.value })}
        erreur={f.erreurs.question_investissement}
        aide="La question à laquelle la note au comité répondra."
      />
      <ZoneTexte
        libelle="Périmètre de l'étude"
        rows={4}
        maxLength={TEXTE_LONG_MAX}
        value={s.perimetre}
        onChange={(e) => maj({ perimetre: e.target.value })}
        erreur={f.erreurs.perimetre}
      />
      {correction ? (
        <ZoneTexte
          libelle="Motif de la correction"
          required
          rows={2}
          maxLength={MOTIF_MAX}
          value={s.motif}
          onChange={(e) => maj({ motif: e.target.value })}
          erreur={f.erreurs.motif}
          aide="Conservé dans l'historique du cadrage."
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {correction ? "Enregistrer la nouvelle version" : "Créer le dossier"}
        </Bouton>
        {correction ? null : (
          <Bouton variante="secondaire" onClick={() => router.back()}>
            Annuler
          </Bouton>
        )}
      </div>
    </form>
  );
}
