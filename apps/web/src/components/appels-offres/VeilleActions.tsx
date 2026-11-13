"use client";

import { useRafraichir } from "../formulaires/useRafraichir";
import { useState } from "react";
import { VEILLE_MOTIF_MIN, type VeilleStatut } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { API_VEILLE, messageVeille } from "../../lib/appels-offres-veille";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { ZoneTexte } from "../ui/ZoneTexte";
import { BoutonActionAo } from "./ActionsAo";

/** Action qui exige un motif (écarter, réexaminer) : 10 caractères au moins, tracé en ajout seul. */
function ActionAvecMotif({
  id,
  action,
  libelle,
}: {
  id: string;
  action: "ecarter" | "reexaminer";
  libelle: string;
}) {
  const t = useT();
  const langue = useLangue();
  const { rafraichir, enAttente } = useRafraichir();
  const [ouvert, setOuvert] = useState(false);
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  if (!ouvert) {
    return (
      <Bouton
        variante={action === "ecarter" ? "danger" : "secondaire"}
        onClick={() => setOuvert(true)}
      >
        {libelle}
      </Bouton>
    );
  }
  const valide = motif.trim().length >= VEILLE_MOTIF_MIN;
  return (
    <div className="mp-pile">
      <ZoneTexte
        libelle={t(
          `Motif (${VEILLE_MOTIF_MIN} caractères au moins)`,
          `Reason (at least ${VEILLE_MOTIF_MIN} characters)`,
        )}
        rows={2}
        maxLength={2000}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
      />
      {erreur ? (
        <Alerte tonalite="danger">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="mp-ao__actions">
        <Bouton
          variante={action === "ecarter" ? "danger" : "primaire"}
          chargement={enCours || enAttente}
          disabled={!valide}
          onClick={async () => {
            setEnCours(true);
            setErreur(null);
            try {
              await api.post(`${API_VEILLE}/resultats/${encodeURIComponent(id)}/${action}`, {
                motif: motif.trim(),
              });
              setOuvert(false);
              setMotif("");
              rafraichir();
            } catch (e) {
              setErreur(messageVeille(e, langue));
            } finally {
              setEnCours(false);
            }
          }}
        >
          {t("Confirmer", "Confirm")}
        </Bouton>
        <Bouton variante="discret" onClick={() => setOuvert(false)}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </div>
  );
}

/** Actions d'un résultat de veille selon son statut : Retenir, Écarter, Réexaminer, Créer la fiche. */
export function VeilleActions({ id, statut }: { id: string; statut: VeilleStatut }) {
  const t = useT();
  const base = `${API_VEILLE}/resultats/${encodeURIComponent(id)}`;
  if (statut === "fiche_creee") return null;
  if (statut === "ecarte") {
    return (
      <div className="mp-ao__actions">
        <ActionAvecMotif id={id} action="reexaminer" libelle={t("Réexaminer", "Reconsider")} />
      </div>
    );
  }
  return (
    <div className="mp-ao__actions">
      {statut === "nouveau" ? (
        <BoutonActionAo variante="secondaire" action={() => api.post(`${base}/retenir`, {})}>
          {t("Retenir", "Shortlist")}
        </BoutonActionAo>
      ) : null}
      <ActionAvecMotif id={id} action="ecarter" libelle={t("Écarter", "Dismiss")} />
      <BoutonActionAo
        variante="primaire"
        confirmation={t(
          "Créer la fiche d'appel d'offres à partir de cet avis ?",
          "Create the tender record from this notice?",
        )}
        action={() => api.post(`${base}/fiche`, {})}
      >
        {t("Créer la fiche", "Create the record")}
      </BoutonActionAo>
    </div>
  );
}
