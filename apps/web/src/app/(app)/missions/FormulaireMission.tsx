"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../components/formulaires/useFormulaire";
import { Bouton, classesBouton } from "../../../components/ui/Bouton";
import { Champ } from "../../../components/ui/Champ";
import { Select, type OptionSelect } from "../../../components/ui/Select";
import { api } from "../../../lib/api";
import { OPTIONS_MODES } from "../../../lib/catalogue";
import {
  SAISIE_MISSION_VIDE,
  validerCreationMission,
  validerModificationMission,
  type ChampMission,
  type Mission,
  type SaisieMission,
} from "../../../lib/missions";
import { OPTIONS_DEVISES } from "../../../lib/pipeline";

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
  const creation = !mission;
  const [s, setS] = useState<SaisieMission>(saisieInitiale);
  const f = useFormulaire<ChampMission>();
  const maj = (champ: ChampMission) => (v: string) => setS((x) => ({ ...x, [champ]: v }));
  const modeDuType = types.find((t) => t.valeur === s.type_mission_id)?.mode;

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const apres = (m: Mission) => {
      router.push(`/missions/${m.id}`);
      router.refresh();
    };
    if (creation) {
      await f.envoyer(validerCreationMission(s), (c) => api.post<Mission>("/api/missions", c), {
        rafraichir: false,
        apres,
      });
    } else {
      await f.envoyer(
        validerModificationMission(s, { signee, reaffecter, designerDirecteur }),
        (c) => api.patch<Mission>(`/api/missions/${encodeURIComponent(mission.id)}`, c),
        { rafraichir: false, apres },
      );
    }
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <Champ
        libelle="Intitulé"
        name="intitule"
        required
        maxLength={200}
        value={s.intitule}
        onChange={(e) => maj("intitule")(e.target.value)}
        erreur={f.erreurs.intitule}
      />
      <div className="mp-grille-champs">
        {creation ? (
          <>
            <Select
              libelle="Client"
              name="client_id"
              required
              options={clients}
              invite={clients.length ? "Choisir le client…" : "Aucun client actif disponible"}
              value={s.client_id}
              onChange={(e) => maj("client_id")(e.target.value)}
              erreur={f.erreurs.client_id}
            />
            <Select
              libelle="Type de mission"
              name="type_mission_id"
              options={types}
              invite="Mission vierge (sans modèle)"
              value={s.type_mission_id}
              onChange={(e) => maj("type_mission_id")(e.target.value)}
              erreur={f.erreurs.type_mission_id}
              aide="Le découpage et les jours types du modèle sont recopiés."
            />
          </>
        ) : null}
        <Select
          libelle="Mode de facturation"
          name="mode_facturation"
          required={!creation || !s.type_mission_id}
          disabled={signee}
          options={OPTIONS_MODES}
          invite={creation && modeDuType ? "Celui du type de mission" : "Choisir…"}
          value={s.mode_facturation}
          onChange={(e) => maj("mode_facturation")(e.target.value)}
          erreur={f.erreurs.mode_facturation}
          aide={signee ? "Figé à la signature de la lettre de mission." : undefined}
        />
        <Select
          libelle="Devise"
          name="devise"
          required
          options={OPTIONS_DEVISES}
          value={s.devise}
          disabled={signee}
          onChange={(e) => maj("devise")(e.target.value)}
          erreur={f.erreurs.devise}
          aide={signee ? "Figée à la signature de la lettre de mission." : undefined}
        />
        {creation || designerDirecteur ? (
          <Select
            libelle="Directeur de mission"
            name="directeur_id"
            options={personnes}
            invite="À désigner"
            value={s.directeur_id}
            onChange={(e) => maj("directeur_id")(e.target.value)}
            erreur={f.erreurs.directeur_id}
            aide="Associé ou directeur de mission : il signe la lettre et valide les révisions."
          />
        ) : null}
        {creation || reaffecter ? (
          <Select
            libelle="Chef de mission"
            name="chef_id"
            options={personnes}
            invite={voitToutes || !creation ? "À désigner" : "Vous-même"}
            value={s.chef_id}
            onChange={(e) => maj("chef_id")(e.target.value)}
            erreur={f.erreurs.chef_id}
            aide={voitToutes || !creation ? undefined : "Vous serez chef de la mission créée."}
          />
        ) : null}
        <Champ
          libelle="Date de début"
          name="date_debut"
          type="date"
          value={s.date_debut}
          onChange={(e) => maj("date_debut")(e.target.value)}
          erreur={f.erreurs.date_debut}
        />
        <Champ
          libelle="Date de fin"
          name="date_fin"
          type="date"
          value={s.date_fin}
          onChange={(e) => maj("date_fin")(e.target.value)}
          erreur={f.erreurs.date_fin}
        />
      </div>
      <fieldset className="mp-groupe">
        <legend className="mp-champ__libelle">Axes analytiques (facultatifs)</legend>
        <div className="mp-grille-champs">
          <Champ
            libelle="Activité"
            name="activite"
            maxLength={120}
            value={s.activite}
            onChange={(e) => maj("activite")(e.target.value)}
            erreur={f.erreurs.activite}
          />
          <Champ
            libelle="Secteur"
            name="secteur"
            maxLength={120}
            value={s.secteur}
            onChange={(e) => maj("secteur")(e.target.value)}
            erreur={f.erreurs.secteur}
          />
          <Champ
            libelle="Bureau"
            name="bureau"
            maxLength={120}
            value={s.bureau}
            onChange={(e) => maj("bureau")(e.target.value)}
            erreur={f.erreurs.bureau}
          />
        </div>
      </fieldset>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {creation ? "Créer la mission" : "Enregistrer"}
        </Bouton>
        <Link
          href={creation ? "/missions" : `/missions/${mission.id}`}
          className={classesBouton("discret")}
        >
          Annuler
        </Link>
      </div>
    </form>
  );
}
