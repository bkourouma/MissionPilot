"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { RedDossierVue, RedSecteur } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { cheminDossierMission, messageRedressement, optionsSecteurs } from "../../lib/redressement";
import { secteurRedressementDepuisClient } from "../../lib/redressement-secteur";
import { corpsDossierDepuisFormulaire, type ChampDossier } from "../../lib/redressement-saisie";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";

/**
 * Ouverture du dossier de redressement d'une mission (directeur, chef ou « modifier toutes les
 * missions »). La devise du dossier est celle de la mission ; l'API juge les droits. Le secteur est
 * proposé d'après le secteur du client de la mission (table prudente de
 * `redressement-secteur.ts`, « général » sans correspondance sûre) ; la lecture est facultative
 * et ne remplace jamais un choix déjà fait par l'utilisateur.
 */
export function FormulaireOuvertureDossier({
  missionId,
  intituleInitial,
}: {
  missionId: string;
  intituleInitial: string;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampDossier>();
  const [intitule, setIntitule] = useState(intituleInitial);
  const [secteur, setSecteur] = useState<RedSecteur>("general");
  const choisi = useRef(false);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const m = await api.get<{ client_id: string }>(`/api/missions/${missionId}`);
        const c = await api.get<{ secteur: string | null }>(`/api/clients/${m.client_id}`);
        if (!annule && !choisi.current) setSecteur(secteurRedressementDepuisClient(c.secteur));
      } catch {
        // Préremplissage facultatif : « général » reste proposé.
      }
    })();
    return () => {
      annule = true;
    };
  }, [missionId]);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      corpsDossierDepuisFormulaire({ intitule, secteur }, langue),
      (charge) => api.post<RedDossierVue>(cheminDossierMission(missionId), charge),
      {
        succes: t("Dossier de redressement ouvert.", "Turnaround file opened."),
        messageSpecifique: (e) => messageRedressement(e, langue),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-red-ouverture"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Ouvrir le dossier de redressement", "Open the turnaround file")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Ouverture impossible", "Could not open")}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Intitulé du dossier", "File title")}
          required
          maxLength={200}
          autoComplete="off"
          value={intitule}
          onChange={(e) => setIntitule(e.target.value)}
          erreur={f.erreurs.intitule}
        />
        <Select
          libelle={t("Secteur d'activité", "Business sector")}
          required
          value={secteur}
          onChange={(e) => {
            choisi.current = true;
            setSecteur(e.target.value as RedSecteur);
          }}
          options={optionsSecteurs(langue)}
          aide={t(
            "Proposé d'après le secteur du client, à ajuster si besoin. Les seuils d'alerte précoce dépendent du secteur.",
            "Suggested from the client's sector, adjust if needed. Early-warning thresholds depend on the sector.",
          )}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement={t("Ouverture…", "Opening…")}>
          {t("Ouvrir le dossier de redressement", "Open the turnaround file")}
        </Bouton>
      </div>
    </form>
  );
}
