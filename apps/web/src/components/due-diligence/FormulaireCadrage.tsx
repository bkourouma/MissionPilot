"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { TYPES_OPERATION_DD } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminCadrage,
  cheminDossiers,
  hrefDossier,
  libellesDd,
  messageDd,
  optionsDe,
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
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

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
  const t = useT();
  const langue = useLangue();
  const optionsType = optionsDe(TYPES_OPERATION_DD, libellesDd(langue).TYPE_OPERATION);
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
      validerCadrage(s, correction !== undefined, langue),
      (charge) =>
        correction
          ? api.post<ReponseEcriture>(cheminCadrage(correction.dossierId), {
              ...charge,
              version_courante: correction.versionCourante,
            })
          : api.post<ReponseEcriture>(cheminDossiers(missionId), charge),
      {
        succes: correction
          ? t(
              "Nouvelle version du cadrage enregistrée ; l'ancienne reste dans l'historique.",
              "New scoping version saved; the previous one stays in the history.",
            )
          : t("Dossier créé.", "File created."),
        messageSpecifique: (err) => messageDd(err, langue),
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
      aria-label={
        correction
          ? t("Corriger le cadrage", "Edit the scoping")
          : t("Cadrage de l'opération", "Transaction scoping")
      }
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Cadrage refusé", "Scoping refused")}
      />
      {taxonomiesAbsentes ? (
        <Alerte
          tonalite="attention"
          titre={t("Listes de choix incomplètes", "Incomplete choice lists")}
          annonce="aucune"
        >
          <p>
            {t(
              "Les secteurs ou les pays n'ont pas pu être chargés. Rechargez la page ; si le problème persiste, vérifiez que vous pouvez consulter le dictionnaire de données.",
              "The sectors or countries could not be loaded. Reload the page; if the problem persists, check that you can view the data dictionary.",
            )}
          </p>
        </Alerte>
      ) : null}
      <Champ
        libelle={t("Titre du dossier", "File title")}
        required
        maxLength={TITRE_MAX}
        value={s.titre}
        onChange={(e) => maj({ titre: e.target.value })}
        erreur={f.erreurs.titre}
      />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Secteur", "Sector")}
          required
          invite={t("Choisir…", "Choose…")}
          options={optionsTaxonomie(secteurs)}
          value={s.secteur_code}
          onChange={(e) => maj({ secteur_code: e.target.value, filiere_code: "" })}
          erreur={f.erreurs.secteur_code}
        />
        <Select
          libelle={t("Filière", "Subsector")}
          invite={
            s.secteur_code === ""
              ? t("Choisissez d'abord le secteur", "Choose the sector first")
              : t("Aucune filière précise", "No specific subsector")
          }
          options={optionsTaxonomie(filieresDuSecteur)}
          value={s.filiere_code}
          onChange={(e) => maj({ filiere_code: e.target.value })}
          disabled={s.secteur_code === "" || filieresDuSecteur.length === 0}
          erreur={f.erreurs.filiere_code}
          aide={
            s.secteur_code !== "" && filieresDuSecteur.length === 0
              ? t(
                  "Aucune filière n'est définie pour ce secteur.",
                  "No subsector is defined for this sector.",
                )
              : undefined
          }
        />
        <Select
          libelle={t("Pays", "Country")}
          required
          invite={t("Choisir…", "Choose…")}
          options={optionsTaxonomie(pays)}
          value={s.pays_code}
          onChange={(e) => maj({ pays_code: e.target.value })}
          erreur={f.erreurs.pays_code}
        />
      </div>
      <div className="mp-grille-champs">
        <Select
          libelle={t("Type d'opération", "Transaction type")}
          required
          invite={t("Choisir…", "Choose…")}
          options={optionsType}
          value={s.type_operation}
          onChange={(e) => maj({ type_operation: e.target.value })}
          erreur={f.erreurs.type_operation}
        />
        <Champ
          libelle={t("Cible", "Target")}
          required={s.type_operation === "acquisition"}
          maxLength={TITRE_MAX}
          value={s.cible_nom}
          onChange={(e) => maj({ cible_nom: e.target.value })}
          erreur={f.erreurs.cible_nom}
          aide={
            s.type_operation === "acquisition"
              ? t("Obligatoire pour une acquisition.", "Required for an acquisition.")
              : t(
                  "Facultatif : l'entreprise ou l'actif visé.",
                  "Optional: the targeted company or asset.",
                )
          }
        />
        <Select
          libelle={t("Devise du dossier", "File currency")}
          required
          options={OPTIONS_DEVISE}
          value={s.devise}
          onChange={(e) => maj({ devise: e.target.value })}
          erreur={f.erreurs.devise}
          aide={t(
            "Les montants du marché sont saisis et affichés dans cette devise.",
            "Market amounts are entered and shown in this currency.",
          )}
        />
        <Champ
          libelle={t("Date d'opération prévue", "Planned transaction date")}
          type="date"
          value={s.date_operation}
          onChange={(e) => maj({ date_operation: e.target.value })}
          erreur={f.erreurs.date_operation}
          aide={t(
            "Facultative ; nécessaire pour dater les actions du plan des 100 jours.",
            "Optional; needed to date the actions of the 100-day plan.",
          )}
        />
      </div>
      <ZoneTexte
        libelle={t("Question d'investissement", "Investment question")}
        rows={3}
        maxLength={ENONCE_MAX}
        value={s.question_investissement}
        onChange={(e) => maj({ question_investissement: e.target.value })}
        erreur={f.erreurs.question_investissement}
        aide={t(
          "La question à laquelle la note au comité répondra.",
          "The question the committee memo will answer.",
        )}
      />
      <ZoneTexte
        libelle={t("Périmètre de l'étude", "Study scope")}
        rows={4}
        maxLength={TEXTE_LONG_MAX}
        value={s.perimetre}
        onChange={(e) => maj({ perimetre: e.target.value })}
        erreur={f.erreurs.perimetre}
      />
      {correction ? (
        <ZoneTexte
          libelle={t("Motif de la correction", "Reason for the correction")}
          required
          rows={2}
          maxLength={MOTIF_MAX}
          value={s.motif}
          onChange={(e) => maj({ motif: e.target.value })}
          erreur={f.erreurs.motif}
          aide={t("Conservé dans l'historique du cadrage.", "Kept in the scoping history.")}
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {correction
            ? t("Enregistrer la nouvelle version", "Save the new version")
            : t("Créer le dossier", "Create the file")}
        </Bouton>
        {correction ? null : (
          <Bouton variante="secondaire" onClick={() => router.back()}>
            {t("Annuler", "Cancel")}
          </Bouton>
        )}
      </div>
    </form>
  );
}
