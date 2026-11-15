"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  actionsDebours,
  libelleCategorie,
  saisieDepuisDebours,
  statutDebours,
  STATUT_DEBOURS,
  type ContexteDebours,
  type Debours,
} from "../../lib/debours";
import { validerMotif } from "../../lib/factures";
import { formaterDate, formaterMontantMineur } from "../../lib/format";
import { CommentairesRepliables } from "../collaboration/Commentaires";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { FichierJoint } from "../fichiers/FichierJoint";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../formulaires/useAttenteRafraichissement";
import { useFermetureDifferee } from "../formulaires/useFermetureDifferee";
import { useFormulaire } from "../formulaires/useFormulaire";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { Icone } from "../ui/Icone";
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
  const t = useT();
  const langue = useLangue();
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
            formaterDate(d.date, "UTC", langue),
            libelleCategorie(d.categorie, langue),
            missionIntitule,
            avecAuteur ? d.collaborateur_nom : null,
            d.refacturable
              ? t("refacturable", "re-billable")
              : t("non refacturable", "non-re-billable"),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {d.justificatif_fichier ? (
          <FichierJoint
            fichier={d.justificatif_fichier}
            prefixe={t("Justificatif", "Supporting document")}
            contexte={t(`du débours ${d.libelle}`, `of expense ${d.libelle}`)}
          />
        ) : d.justificatif ? (
          <span className="mp-texte-petit mp-coupure">
            {t(
              `Ancienne référence de justificatif : ${d.justificatif}`,
              `Previous supporting document reference: ${d.justificatif}`,
            )}
          </span>
        ) : (
          <span className="mp-indice mp-texte-petit mp-texte-doux">
            <Icone nom="attention" taille={14} />
            <span>{t("Sans justificatif joint", "No supporting document attached")}</span>
          </span>
        )}
        {d.statut === "rejete" && d.motif_rejet ? (
          <span className="mp-texte-petit">
            {t(`Motif du rejet : ${d.motif_rejet}`, `Reason for rejection: ${d.motif_rejet}`)}
          </span>
        ) : null}
      </span>
      <span className="mp-montant">{formaterMontantMineur(d.montant, d.devise, langue)}</span>
      <BadgeStatut tonalite={STATUT_DEBOURS[d.statut].tonalite}>
        {statutDebours(d.statut, langue).libelle}
      </BadgeStatut>
      <div className="mp-barre-actions mp-barre-actions--compacte">
        {a.soumettre && !edition ? (
          <Bouton
            variante="secondaire"
            icone="envoyer"
            chargement={f.enCours || attente}
            texteChargement={t("Envoi…", "Sending…")}
            onClick={() =>
              agir(
                "soumettre",
                t("Débours soumis à validation.", "Expense submitted for approval."),
              )
            }
            aria-label={t(`Soumettre le débours ${d.libelle}`, `Submit expense ${d.libelle}`)}
          >
            {t("Soumettre", "Submit")}
          </Bouton>
        ) : null}
        {a.modifier && !edition ? (
          <Bouton
            variante="discret"
            icone="crayon"
            onClick={() => setEdition(true)}
            aria-label={t(`Modifier le débours ${d.libelle}`, `Edit expense ${d.libelle}`)}
          >
            {t("Modifier", "Edit")}
          </Bouton>
        ) : null}
        {a.supprimer && !edition ? (
          <BoutonConfirmation
            libelle={t("Supprimer", "Delete")}
            variante="discret"
            icone="corbeille"
            ariaLabel={t(`Supprimer le débours ${d.libelle}`, `Delete expense ${d.libelle}`)}
            question={t(
              `Supprimer le débours « ${d.libelle} » ?`,
              `Delete the expense "${d.libelle}"?`,
            )}
            libelleConfirmation={t("Oui, supprimer", "Yes, delete")}
            texteChargement={t("Suppression…", "Deleting…")}
            action={() => f.envoyer({ ok: true, charge: null }, () => api.supprimer(chemin))}
          />
        ) : null}
        {a.valider && !rejet ? (
          <Bouton
            icone="succes"
            chargement={f.enCours || attente}
            texteChargement={t("Validation…", "Approving…")}
            onClick={() => agir("valider", t("Débours validé.", "Expense approved."))}
            aria-label={t(`Valider le débours ${d.libelle}`, `Approve expense ${d.libelle}`)}
          >
            {t("Valider", "Approve")}
          </Bouton>
        ) : null}
        {a.rejeter && !rejet ? (
          <Bouton
            variante="secondaire"
            onClick={() => setRejet(true)}
            aria-label={t(`Rejeter le débours ${d.libelle}`, `Reject expense ${d.libelle}`)}
          >
            {t("Rejeter", "Reject")}
          </Bouton>
        ) : null}
      </div>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Action impossible", "Action not possible")}
      />
      {rejet ? (
        <FormulaireRejet chemin={chemin} libelle={d.libelle} onFin={() => setRejet(false)} />
      ) : null}
      {edition ? (
        <FormulaireDebours
          titre={t(`Modifier le débours ${d.libelle}`, `Edit expense ${d.libelle}`)}
          initial={saisieDepuisDebours(d)}
          missions={[{ id: d.mission_id, intitule: missionIntitule ?? "", devise: d.devise }]}
          deboursId={d.id}
          justificatif={d.justificatif_fichier}
          ancienneReference={d.justificatif}
          onFin={() => setEdition(null)}
          onEnregistre={fermerApresRafraichissement}
        />
      ) : null}
      <div className="mp-pleine-largeur">
        <CommentairesRepliables
          entiteType="debours"
          entiteId={d.id}
          utilisateurId={contexte.utilisateurId}
          associe={contexte.roles.includes("associe")}
          nomElement={t(`le débours ${d.libelle}`, `expense ${d.libelle}`)}
        />
      </div>
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
  const t = useT();
  const langue = useLangue();
  const [motif, setMotif] = useState("");
  const f = useFormulaire<"motif">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerMotif(motif, langue), (c) => api.post(`${chemin}/rejeter`, c), {
      apres: onFin,
    });
  }
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire mp-pleine-largeur"
      noValidate
      onSubmit={soumettre}
      aria-label={t(`Rejeter le débours ${libelle}`, `Reject expense ${libelle}`)}
    >
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <ZoneTexte
        libelle={t("Motif du rejet", "Reason for rejection")}
        aide={t(
          "Visible par l'auteur, qui pourra corriger et soumettre à nouveau.",
          "Visible to the author, who can correct and resubmit.",
        )}
        required
        maxLength={500}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="danger"
          chargement={f.enCours}
          texteChargement={t("Rejet…", "Rejecting…")}
        >
          {t("Rejeter le débours", "Reject the expense")}
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}
