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
import type { Devise } from "../../../lib/format";
import {
  OPTIONS_DEVISES,
  OPTIONS_ETAPES,
  SAISIE_OPPORTUNITE_VIDE,
  validerOpportunite,
  type ChampOpportunite,
  type Opportunite,
  type SaisieOpportunite,
} from "../../../lib/pipeline";
import { aideMontant } from "../../../lib/saisie";

export interface FormulaireOpportuniteProps {
  clients: readonly OptionSelect[];
  types: readonly OptionSelect[];
  personnes: readonly OptionSelect[];
  /** Absente : création. */
  opportunite?: Opportunite;
  saisieInitiale?: SaisieOpportunite;
}

/** Création ou modification d'une opportunité (l'étape se change depuis la fiche). */
export function FormulaireOpportunite({
  clients,
  types,
  personnes,
  opportunite,
  saisieInitiale = SAISIE_OPPORTUNITE_VIDE,
}: FormulaireOpportuniteProps) {
  const router = useRouter();
  const creation = !opportunite;
  const [s, setS] = useState<SaisieOpportunite>(saisieInitiale);
  const f = useFormulaire<ChampOpportunite>();
  const maj = (champ: ChampOpportunite) => (v: string) => setS((x) => ({ ...x, [champ]: v }));

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerOpportunite(s, creation ? "creation" : "modification"),
      (charge) =>
        creation
          ? api.post<Opportunite>("/api/opportunites", charge)
          : api.patch<Opportunite>(
              `/api/opportunites/${encodeURIComponent(opportunite.id)}`,
              charge,
            ),
      {
        rafraichir: false,
        apres: (o) => {
          router.push(`/pipeline/${o.id}`);
          router.refresh();
        },
      },
    );
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
        aide="Exemple : Plan stratégique 2027-2031 de la société X."
      />
      <div className="mp-grille-champs">
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
          libelle="Type de mission envisagé"
          name="type_mission_id"
          options={types}
          invite="Pas encore défini"
          value={s.type_mission_id}
          onChange={(e) => maj("type_mission_id")(e.target.value)}
          erreur={f.erreurs.type_mission_id}
          aide="Proposé par défaut pour générer la proposition."
        />
        <Select
          libelle="Devise"
          name="devise"
          required
          options={OPTIONS_DEVISES}
          value={s.devise}
          onChange={(e) => maj("devise")(e.target.value)}
          erreur={f.erreurs.devise}
        />
        <Champ
          libelle="Montant estimé"
          name="montant_estime"
          inputMode="decimal"
          autoComplete="off"
          value={s.montant_estime}
          onChange={(e) => maj("montant_estime")(e.target.value)}
          erreur={f.erreurs.montant_estime}
          aide={aideMontant(s.devise as Devise)}
        />
        <Champ
          libelle="Probabilité de gain (%)"
          name="probabilite"
          required
          inputMode="numeric"
          autoComplete="off"
          value={s.probabilite}
          onChange={(e) => maj("probabilite")(e.target.value)}
          erreur={f.erreurs.probabilite}
          aide="Entre 0 et 100."
        />
        {creation ? (
          <Select
            libelle="Étape"
            name="etape"
            required
            options={OPTIONS_ETAPES}
            value={s.etape}
            onChange={(e) => maj("etape")(e.target.value)}
            erreur={f.erreurs.etape}
          />
        ) : null}
        <Select
          libelle="Responsable"
          name="responsable_id"
          options={personnes}
          invite={personnes.length ? "Non désigné" : "Liste des personnes indisponible"}
          value={s.responsable_id}
          onChange={(e) => maj("responsable_id")(e.target.value)}
          erreur={f.erreurs.responsable_id}
        />
        <Champ
          libelle="Date de clôture prévue"
          name="date_cloture_prevue"
          type="date"
          value={s.date_cloture_prevue}
          onChange={(e) => maj("date_cloture_prevue")(e.target.value)}
          erreur={f.erreurs.date_cloture_prevue}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {creation ? "Créer l'opportunité" : "Enregistrer"}
        </Bouton>
        <Link
          href={creation ? "/pipeline" : `/pipeline/${opportunite.id}`}
          className={classesBouton("discret")}
        >
          Annuler
        </Link>
      </div>
    </form>
  );
}
