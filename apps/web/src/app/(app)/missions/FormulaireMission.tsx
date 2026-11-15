"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRafraichir } from "../../../components/formulaires/useRafraichir";
import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../components/formulaires/useFormulaire";
import { useLangue, useT } from "../../../components/i18n/FournisseurLangue";
import { Bouton, classesBouton } from "../../../components/ui/Bouton";
import { Champ } from "../../../components/ui/Champ";
import { Select, type OptionSelect } from "../../../components/ui/Select";
import { api } from "../../../lib/api";
import { optionsModes } from "../../../lib/catalogue";
import {
  SAISIE_MISSION_VIDE,
  validerCreationMission,
  validerModificationMission,
  type ChampMission,
  type Mission,
  type SaisieMission,
} from "../../../lib/missions";
import { optionsDevises } from "../../../lib/pipeline";

export interface FormulaireMissionProps {
  clients: readonly OptionSelect[];
  types: readonly (OptionSelect & { mode: string })[];
  personnes: readonly OptionSelect[];
  /** Sans « mission.lire_toutes », le créateur devient chef de la mission qu'il crée. */
  voitToutes: boolean;
  /** Modification : réaffecter le chef (« mission.modifier_toutes »). */
  reaffecter?: boolean;
  /** Modification : changer le directeur (associé). */
  designerDirecteur?: boolean;
  /** Modification : mission existante. */
  mission?: Mission;
  saisieInitiale?: SaisieMission;
  /** Modification : la lettre de mission est signée (devise figée). */
  signee?: boolean;
}

/** Création d'une mission (depuis un type ou vierge) ou modification de sa fiche (MIS-09). */
export function FormulaireMission({
  clients,
  types,
  personnes,
  voitToutes,
  mission,
  saisieInitiale = SAISIE_MISSION_VIDE,
  signee = false,
  reaffecter = false,
  designerDirecteur = false,
}: FormulaireMissionProps) {
  const router = useRouter();
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
  const creation = !mission;
  const [s, setS] = useState<SaisieMission>(saisieInitiale);
  const f = useFormulaire<ChampMission>();
  const maj = (champ: ChampMission) => (v: string) => setS((x) => ({ ...x, [champ]: v }));
  const modeDuType = types.find((ty) => ty.valeur === s.type_mission_id)?.mode;

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const apres = (m: Mission) => {
      router.push(`/missions/${m.id}`);
      rafraichir();
    };
    if (creation) {
      await f.envoyer(
        validerCreationMission(s, langue),
        (c) => api.post<Mission>("/api/missions", c),
        {
          rafraichir: false,
          apres,
        },
      );
    } else {
      await f.envoyer(
        validerModificationMission(s, { signee, reaffecter, designerDirecteur }, langue),
        (c) => api.patch<Mission>(`/api/missions/${encodeURIComponent(mission.id)}`, c),
        { rafraichir: false, apres },
      );
    }
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <Champ
        libelle={t("Intitulé", "Title")}
        name="intitule"
        required
        maxLength={200}
        value={s.intitule}
        onChange={(e) => maj("intitule")(e.target.value)}
        erreur={f.erreurs.intitule}
      />
      <div className="mp-grille-champs mp-grille-champs--bas">
        {creation ? (
          <>
            <Select
              libelle={t("Client", "Client")}
              name="client_id"
              required
              options={clients}
              invite={
                clients.length
                  ? t("Choisir le client…", "Choose the client…")
                  : t("Aucun client actif disponible", "No active client available")
              }
              value={s.client_id}
              onChange={(e) => maj("client_id")(e.target.value)}
              erreur={f.erreurs.client_id}
            />
            <Select
              libelle={t("Type de mission", "Engagement type")}
              name="type_mission_id"
              options={types}
              invite={t("Mission vierge (sans modèle)", "Blank engagement (no template)")}
              value={s.type_mission_id}
              onChange={(e) => maj("type_mission_id")(e.target.value)}
              erreur={f.erreurs.type_mission_id}
              aide={t(
                "Le découpage et les jours types du modèle sont recopiés.",
                "The template's work breakdown and standard days are copied.",
              )}
            />
          </>
        ) : null}
        <Select
          libelle={t("Mode de facturation", "Billing mode")}
          name="mode_facturation"
          required={!creation || !s.type_mission_id}
          disabled={signee}
          options={optionsModes(langue)}
          invite={
            creation && modeDuType
              ? t("Celui du type de mission", "The engagement type's mode")
              : t("Choisir…", "Choose…")
          }
          value={s.mode_facturation}
          onChange={(e) => maj("mode_facturation")(e.target.value)}
          erreur={f.erreurs.mode_facturation}
          aide={
            signee
              ? t(
                  "Figé à la signature de la lettre de mission.",
                  "Locked once the engagement letter is signed.",
                )
              : undefined
          }
        />
        <Select
          libelle={t("Devise", "Currency")}
          name="devise"
          required
          options={optionsDevises(langue)}
          value={s.devise}
          disabled={signee}
          onChange={(e) => maj("devise")(e.target.value)}
          erreur={f.erreurs.devise}
          aide={
            signee
              ? t(
                  "Figée à la signature de la lettre de mission.",
                  "Locked once the engagement letter is signed.",
                )
              : undefined
          }
        />
        {creation || designerDirecteur ? (
          <Select
            libelle={t("Directeur de mission", "Engagement director")}
            name="directeur_id"
            options={personnes}
            invite={t("À désigner", "To be assigned")}
            value={s.directeur_id}
            onChange={(e) => maj("directeur_id")(e.target.value)}
            erreur={f.erreurs.directeur_id}
            aide={t(
              "Associé ou directeur de mission : il signe la lettre et valide les révisions.",
              "Partner or engagement director: signs the letter and approves revisions.",
            )}
          />
        ) : null}
        {creation || reaffecter ? (
          <Select
            libelle={t("Chef de mission", "Engagement manager")}
            name="chef_id"
            options={personnes}
            invite={
              voitToutes || !creation
                ? t("À désigner", "To be assigned")
                : t("Vous-même", "Yourself")
            }
            value={s.chef_id}
            onChange={(e) => maj("chef_id")(e.target.value)}
            erreur={f.erreurs.chef_id}
            aide={
              voitToutes || !creation
                ? undefined
                : t(
                    "Vous serez chef de la mission créée.",
                    "You will be the manager of the created engagement.",
                  )
            }
          />
        ) : null}
        <Champ
          libelle={t("Date de début", "Start date")}
          name="date_debut"
          type="date"
          value={s.date_debut}
          onChange={(e) => maj("date_debut")(e.target.value)}
          erreur={f.erreurs.date_debut}
        />
        <Champ
          libelle={t("Date de fin", "End date")}
          name="date_fin"
          type="date"
          value={s.date_fin}
          onChange={(e) => maj("date_fin")(e.target.value)}
          erreur={f.erreurs.date_fin}
        />
      </div>
      <fieldset className="mp-groupe">
        <legend className="mp-champ__libelle">
          {t("Axes analytiques (facultatifs)", "Analytical dimensions (optional)")}
        </legend>
        <div className="mp-grille-champs mp-grille-champs--bas">
          <Champ
            libelle={t("Activité", "Activity")}
            name="activite"
            maxLength={120}
            value={s.activite}
            onChange={(e) => maj("activite")(e.target.value)}
            erreur={f.erreurs.activite}
          />
          <Champ
            libelle={t("Secteur", "Sector")}
            name="secteur"
            maxLength={120}
            value={s.secteur}
            onChange={(e) => maj("secteur")(e.target.value)}
            erreur={f.erreurs.secteur}
          />
          <Champ
            libelle={t("Bureau", "Office")}
            name="bureau"
            maxLength={120}
            value={s.bureau}
            onChange={(e) => maj("bureau")(e.target.value)}
            erreur={f.erreurs.bureau}
          />
        </div>
      </fieldset>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {creation ? t("Créer la mission", "Create the engagement") : t("Enregistrer", "Save")}
        </Bouton>
        <Link
          href={creation ? "/missions" : `/missions/${mission.id}`}
          className={classesBouton("discret")}
        >
          {t("Annuler", "Cancel")}
        </Link>
      </div>
    </form>
  );
}
