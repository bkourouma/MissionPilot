"use client";

import Link from "next/link";
import type { Role } from "@missionpilot/shared";
import { useLangue, useT } from "../../../components/i18n/FournisseurLangue";
import { RetourFormulaire } from "../../../components/formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../../../components/formulaires/useAttenteRafraichissement";
import { useFormulaire } from "../../../components/formulaires/useFormulaire";
import { EVENEMENT_TACHES } from "../../../components/shell/PastilleTaches";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { Bouton } from "../../../components/ui/Bouton";
import { Icone } from "../../../components/ui/Icone";
import { api } from "../../../lib/api";
import { formaterDate } from "../../../lib/format";
import { aujourdhuiIso } from "../../../lib/missions";
import {
  actionsTache,
  enRetard,
  ENTITE_ICONES,
  libelleEntite,
  libelleStatutTache,
  lienEntite,
  STATUT_TACHE,
  transitionsStatut,
  type TacheCollaboration,
} from "../../../lib/taches-collaboration";

export interface CarteTacheProps {
  tache: TacheCollaboration;
  utilisateurId: string;
  roles: readonly Role[];
  /** Lien vers la fiche de la tâche (liste) ; absent sur la fiche elle-même. */
  avecLienDetail?: boolean;
}

const CONFIRMATION: Record<TacheCollaboration["statut"], [string, string]> = {
  a_faire: ["remise à faire", "set back to to do"],
  en_cours: ["passée en cours", "set to in progress"],
  fait: ["marquée comme faite", "marked as done"],
};

const vous = (id: string, nom: string, moi: string, you: string) =>
  id === moi ? `${nom} (${you})` : nom;

/** Une tâche assignée : titre, statut (texte + icône), échéance, élément lié, changement de statut. */
export function CarteTache({ tache, utilisateurId, roles, avecLienDetail }: CarteTacheProps) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<never>();
  const [attente, marquer] = useAttenteRafraichissement(
    `${tache.id}-${tache.statut}-${tache.modifie_le}`,
  );
  const a = actionsTache(tache, utilisateurId, roles);
  const statut = STATUT_TACHE[tache.statut];
  const retard = enRetard(tache, aujourdhuiIso());
  const lien = lienEntite(tache);

  const changer = (cible: TacheCollaboration["statut"]) =>
    f.envoyer(
      { ok: true, charge: { statut: cible } },
      (c) => api.patch(`/api/taches-collaboration/${encodeURIComponent(tache.id)}`, c),
      {
        succes: t(
          `Tâche « ${tache.titre} » ${CONFIRMATION[cible][0]}.`,
          `Task "${tache.titre}" ${CONFIRMATION[cible][1]}.`,
        ),
        apres: () => {
          marquer();
          window.dispatchEvent(new Event(EVENEMENT_TACHES));
        },
      },
    );

  return (
    <li className={tache.statut === "fait" ? "mp-tache mp-tache--faite" : "mp-tache"}>
      <div className="mp-tache__entete">
        {avecLienDetail ? (
          <Link href={`/mes-taches/${tache.id}`} className="mp-tache__titre mp-coupure">
            {tache.titre}
          </Link>
        ) : (
          // Fiche : le titre est déjà l'en-tête de la page.
          <span className="mp-texte-doux mp-texte-petit">
            {t("Statut et échéance", "Status and due date")}
          </span>
        )}
        <BadgeStatut tonalite={statut.tonalite}>
          {libelleStatutTache(tache.statut, langue)}
        </BadgeStatut>
      </div>
      <dl className="mp-tache__infos">
        <div>
          <dt>{t("Échéance", "Due date")}</dt>
          <dd className={retard ? "mp-tache__retard" : undefined}>
            <span>
              {tache.echeance
                ? formaterDate(tache.echeance, "UTC", langue)
                : t("Sans échéance", "No due date")}
            </span>
            {retard ? (
              <span className="mp-tache__retard-libelle">
                <Icone nom="attention" taille={14} />
                <span>{t("en retard", "overdue")}</span>
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>{t("Assignée à", "Assigned to")}</dt>
          <dd>{vous(tache.assignee_id, tache.assignee_nom, utilisateurId, t("vous", "you"))}</dd>
        </div>
        <div>
          <dt>{t("Créée par", "Created by")}</dt>
          <dd>{vous(tache.cree_par, tache.cree_par_nom, utilisateurId, t("vous", "you"))}</dd>
        </div>
        {tache.entite_type ? (
          <div>
            <dt>{t("Lié à", "Linked to")}</dt>
            <dd>
              <Icone nom={ENTITE_ICONES[tache.entite_type]} taille={16} />
              {lien ? (
                <Link href={lien}>{libelleEntite(tache.entite_type, langue)}</Link>
              ) : (
                libelleEntite(tache.entite_type, langue)
              )}
            </dd>
          </div>
        ) : null}
        {tache.statut === "fait" && tache.fait_le ? (
          <div>
            <dt>{t("Faite le", "Done on")}</dt>
            <dd>{formaterDate(tache.fait_le, "Africa/Abidjan", langue)}</dd>
          </div>
        ) : null}
      </dl>
      {a.changerStatut ? (
        <div className="mp-barre-actions mp-barre-actions--compacte">
          {transitionsStatut(tache.statut, langue).map((x, i) => (
            <Bouton
              key={x.cible}
              variante={i === 0 ? "secondaire" : "discret"}
              icone={x.cible === "fait" ? "succes" : undefined}
              chargement={f.enCours || attente}
              texteChargement={t("Enregistrement…", "Saving…")}
              onClick={() => void changer(x.cible)}
              aria-label={`${x.libelle} : ${tache.titre}`}
            >
              {x.libelle}
            </Bouton>
          ))}
        </div>
      ) : null}
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Changement impossible", "Change not possible")}
      />
    </li>
  );
}
