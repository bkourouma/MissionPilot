"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  actionsDebours,
  CATEGORIE_LIBELLES,
  saisieDepuisDebours,
  STATUT_DEBOURS,
  type ContexteDebours,
  type Debours,
} from "../../lib/debours";
import { validerMotif } from "../../lib/factures";
import { formaterDate, formaterMontantMineur } from "../../lib/format";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../formulaires/useAttenteRafraichissement";
import { useFermetureDifferee } from "../formulaires/useFermetureDifferee";
import { useFormulaire } from "../formulaires/useFormulaire";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { ZoneTexte } from "../ui/ZoneTexte";
import { FormulaireDebours } from "./FormulaireDebours";

export interface LigneDeboursProps {
  debours: Debours;
  contexte: ContexteDebours;
  /** Intitulé de la mission (liste « Mes débours »), absent dans l'onglet de la mission. */
  missionIntitule?: string;
  /** Affiche l'auteur (onglet de la mission, vue du valideur). */
  avecAuteur?: boolean;
}

/** Un débours : montant, statut, motif de rejet et actions permises par le rôle et le statut. */
export function LigneDebours({
  debours: d,
  contexte,
  missionIntitule,
  avecAuteur,
}: LigneDeboursProps) {
  const [edition, setEdition, fermerApresRafraichissement] = useFermetureDifferee<true>(
    d.modifie_le,
  );
  const [rejet, setRejet] = useState(false);
  const f = useFormulaire<never>();
  const [attente, marquer] = useAttenteRafraichissement(`${d.statut}-${d.modifie_le}`);
  const a = actionsDebours(d, contexte);
  const chemin = `/api/debours/${encodeURIComponent(d.id)}`;
  const agir = (suffixe: "soumettre" | "valider", succes: string) =>
    f.envoyer({ ok: true, charge: null }, () => api.post(`${chemin}/${suffixe}`), {
      succes,
      apres: marquer,
    });

  return (
    <li className="mp-liste-lignes__ligne mp-debours">
      <span className="mp-liste-lignes__texte">
        <strong>{d.libelle}</strong>
        <span className="mp-texte-doux">
          {[
            formaterDate(d.date),
            CATEGORIE_LIBELLES[d.categorie],
            missionIntitule,
            avecAuteur ? d.collaborateur_nom : null,
            d.refacturable ? "refacturable" : "non refacturable",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {d.justificatif ? (
          <span className="mp-texte-petit mp-coupure">{`Justificatif : ${d.justificatif}`}</span>
        ) : (
          <span className="mp-texte-petit mp-texte-doux">Sans référence de justificatif</span>
        )}
        {d.statut === "rejete" && d.motif_rejet ? (
          <span className="mp-texte-petit">{`Motif du rejet : ${d.motif_rejet}`}</span>
        ) : null}
      </span>
      <span className="mp-montant">{formaterMontantMineur(d.montant, d.devise)}</span>
      <BadgeStatut tonalite={STATUT_DEBOURS[d.statut].tonalite}>
        {STATUT_DEBOURS[d.statut].libelle}
      </BadgeStatut>
      <div className="mp-barre-actions mp-barre-actions--compacte">
        {a.soumettre && !edition ? (
          <Bouton
            variante="secondaire"
            icone="envoyer"
            chargement={f.enCours || attente}
            texteChargement="Envoi…"
            onClick={() => agir("soumettre", "Débours soumis à validation.")}
            aria-label={`Soumettre le débours ${d.libelle}`}
          >
            Soumettre
          </Bouton>
        ) : null}
        {a.modifier && !edition ? (
          <Bouton
            variante="discret"
            icone="crayon"
            onClick={() => setEdition(true)}
            aria-label={`Modifier le débours ${d.libelle}`}
          >
            Modifier
          </Bouton>
        ) : null}
        {a.supprimer && !edition ? (
          <BoutonConfirmation
            libelle="Supprimer"
            variante="discret"
            icone="corbeille"
            ariaLabel={`Supprimer le débours ${d.libelle}`}
            question={`Supprimer le débours « ${d.libelle} » ?`}
            libelleConfirmation="Oui, supprimer"
            texteChargement="Suppression…"
            action={() => f.envoyer({ ok: true, charge: null }, () => api.supprimer(chemin))}
          />
        ) : null}
        {a.valider && !rejet ? (
          <Bouton
            icone="succes"
            chargement={f.enCours || attente}
            texteChargement="Validation…"
            onClick={() => agir("valider", "Débours validé.")}
            aria-label={`Valider le débours ${d.libelle}`}
          >
            Valider
          </Bouton>
        ) : null}
        {a.rejeter && !rejet ? (
          <Bouton
            variante="secondaire"
            onClick={() => setRejet(true)}
            aria-label={`Rejeter le débours ${d.libelle}`}
          >
            Rejeter
          </Bouton>
        ) : null}
      </div>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Action impossible"
      />
      {rejet ? (
        <FormulaireRejet chemin={chemin} libelle={d.libelle} onFin={() => setRejet(false)} />
      ) : null}
      {edition ? (
        <FormulaireDebours
          titre={`Modifier le débours ${d.libelle}`}
          initial={saisieDepuisDebours(d)}
          missions={[{ id: d.mission_id, intitule: missionIntitule ?? "", devise: d.devise }]}
          deboursId={d.id}
          onFin={() => setEdition(null)}
          onEnregistre={fermerApresRafraichissement}
        />
      ) : null}
    </li>
  );
}

function FormulaireRejet({
  chemin,
  libelle,
  onFin,
}: {
  chemin: string;
  libelle: string;
  onFin: () => void;
}) {
  const [motif, setMotif] = useState("");
  const f = useFormulaire<"motif">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerMotif(motif), (c) => api.post(`${chemin}/rejeter`, c), { apres: onFin });
  }
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire mp-pleine-largeur"
      noValidate
      onSubmit={soumettre}
      aria-label={`Rejeter le débours ${libelle}`}
    >
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <ZoneTexte
        libelle="Motif du rejet"
        aide="Visible par l'auteur, qui pourra corriger et soumettre à nouveau."
        required
        maxLength={500}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" variante="danger" chargement={f.enCours} texteChargement="Rejet…">
          Rejeter le débours
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
