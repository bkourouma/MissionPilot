"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRafraichir } from "../../../components/formulaires/useRafraichir";
import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../components/formulaires/useFormulaire";
import { Bouton, classesBouton } from "../../../components/ui/Bouton";
import { Champ } from "../../../components/ui/Champ";
import { Select, type OptionSelect } from "../../../components/ui/Select";
import { useLangue, useT } from "../../../components/i18n/FournisseurLangue";
import { api } from "../../../lib/api";
import type { Devise } from "../../../lib/format";
import {
  optionsDevises,
  optionsEtapes,
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
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
  const creation = !opportunite;
  const [s, setS] = useState<SaisieOpportunite>(saisieInitiale);
  const f = useFormulaire<ChampOpportunite>();
  const maj = (champ: ChampOpportunite) => (v: string) => setS((x) => ({ ...x, [champ]: v }));

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerOpportunite(s, creation ? "creation" : "modification", langue),
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
          rafraichir();
        },
      },
    );
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
        aide={t(
          "Exemple : Plan stratégique 2027-2031 de la société X.",
          "Example: 2027-2031 strategic plan for company X.",
        )}
      />
      <div className="mp-grille-champs">
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
          libelle={t("Type de mission envisagé", "Planned engagement type")}
          name="type_mission_id"
          options={types}
          invite={t("Pas encore défini", "Not yet defined")}
          value={s.type_mission_id}
          onChange={(e) => maj("type_mission_id")(e.target.value)}
          erreur={f.erreurs.type_mission_id}
          aide={t(
            "Proposé par défaut pour générer la proposition.",
            "Suggested by default to generate the proposal.",
          )}
        />
        <Select
          libelle={t("Devise", "Currency")}
          name="devise"
          required
          options={optionsDevises(langue)}
          value={s.devise}
          onChange={(e) => maj("devise")(e.target.value)}
          erreur={f.erreurs.devise}
        />
        <Champ
          libelle={t("Montant estimé", "Estimated amount")}
          name="montant_estime"
          inputMode="decimal"
          autoComplete="off"
          value={s.montant_estime}
          onChange={(e) => maj("montant_estime")(e.target.value)}
          erreur={f.erreurs.montant_estime}
          aide={aideMontant(s.devise as Devise, langue)}
        />
        <Champ
          libelle={t("Probabilité de gain (%)", "Win probability (%)")}
          name="probabilite"
          required
          inputMode="numeric"
          autoComplete="off"
          value={s.probabilite}
          onChange={(e) => maj("probabilite")(e.target.value)}
          erreur={f.erreurs.probabilite}
          aide={t("Entre 0 et 100.", "Between 0 and 100.")}
        />
        {creation ? (
          <Select
            libelle={t("Étape", "Stage")}
            name="etape"
            required
            options={optionsEtapes(langue)}
            value={s.etape}
            onChange={(e) => maj("etape")(e.target.value)}
            erreur={f.erreurs.etape}
          />
        ) : null}
        <Select
          libelle={t("Responsable", "Owner")}
          name="responsable_id"
          options={personnes}
          invite={
            personnes.length
              ? t("Non désigné", "Not assigned")
              : t("Liste des personnes indisponible", "List of people unavailable")
          }
          value={s.responsable_id}
          onChange={(e) => maj("responsable_id")(e.target.value)}
          erreur={f.erreurs.responsable_id}
        />
        <Champ
          libelle={t("Date de clôture prévue", "Expected close date")}
          name="date_cloture_prevue"
          type="date"
          value={s.date_cloture_prevue}
          onChange={(e) => maj("date_cloture_prevue")(e.target.value)}
          erreur={f.erreurs.date_cloture_prevue}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {creation ? t("Créer l'opportunité", "Create opportunity") : t("Enregistrer", "Save")}
        </Bouton>
        <Link
          href={creation ? "/pipeline" : `/pipeline/${opportunite.id}`}
          className={classesBouton("discret")}
        >
          {t("Annuler", "Cancel")}
        </Link>
      </div>
    </form>
  );
}
