"use client";

import Link from "next/link";
import type { Role } from "@missionpilot/shared";
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
  ENTITE_LIBELLES,
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

const CONFIRMATION: Record<TacheCollaboration["statut"], string> = {
  a_faire: "remise à faire",
  en_cours: "passée en cours",
  fait: "marquée comme faite",
};

const vous = (id: string, nom: string, moi: string) => (id === moi ? `${nom} (vous)` : nom);

/** Une tâche assignée : titre, statut (texte + icône), échéance, élément lié, changement de statut. */
export function CarteTache({ tache: t, utilisateurId, roles, avecLienDetail }: CarteTacheProps) {
  const f = useFormulaire<never>();
  const [attente, marquer] = useAttenteRafraichissement(`${t.id}-${t.statut}-${t.modifie_le}`);
  const a = actionsTache(t, utilisateurId, roles);
  const statut = STATUT_TACHE[t.statut];
  const retard = enRetard(t, aujourdhuiIso());
  const lien = lienEntite(t);

  const changer = (cible: TacheCollaboration["statut"]) =>
    f.envoyer(
      { ok: true, charge: { statut: cible } },
      (c) => api.patch(`/api/taches-collaboration/${encodeURIComponent(t.id)}`, c),
      {
        succes: `Tâche « ${t.titre} » ${CONFIRMATION[cible]}.`,
        apres: () => {
          marquer();
          window.dispatchEvent(new Event(EVENEMENT_TACHES));
        },
      },
    );

  return (
    <li className={t.statut === "fait" ? "mp-tache mp-tache--faite" : "mp-tache"}>
      <div className="mp-tache__entete">
        {avecLienDetail ? (
          <Link href={`/mes-taches/${t.id}`} className="mp-tache__titre mp-coupure">
            {t.titre}
          </Link>
        ) : (
          // Fiche : le titre est déjà l'en-tête de la page.
          <span className="mp-texte-doux mp-texte-petit">Statut et échéance</span>
        )}
        <BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>
      </div>
      <dl className="mp-tache__infos">
        <div>
          <dt>Échéance</dt>
          <dd className={retard ? "mp-tache__retard" : undefined}>
            <span>{t.echeance ? formaterDate(t.echeance) : "Sans échéance"}</span>
            {retard ? (
              <span className="mp-tache__retard-libelle">
                <Icone nom="attention" taille={14} />
                <span>en retard</span>
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Assignée à</dt>
          <dd>{vous(t.assignee_id, t.assignee_nom, utilisateurId)}</dd>
        </div>
        <div>
          <dt>Créée par</dt>
          <dd>{vous(t.cree_par, t.cree_par_nom, utilisateurId)}</dd>
        </div>
        {t.entite_type ? (
          <div>
            <dt>Lié à</dt>
            <dd>
              <Icone nom={ENTITE_ICONES[t.entite_type]} taille={16} />
              {lien ? (
                <Link href={lien}>{ENTITE_LIBELLES[t.entite_type]}</Link>
              ) : (
                ENTITE_LIBELLES[t.entite_type]
              )}
            </dd>
          </div>
        ) : null}
        {t.statut === "fait" && t.fait_le ? (
          <div>
            <dt>Faite le</dt>
            <dd>{formaterDate(t.fait_le, "Africa/Abidjan")}</dd>
          </div>
        ) : null}
      </dl>
      {a.changerStatut ? (
        <div className="mp-barre-actions mp-barre-actions--compacte">
          {transitionsStatut(t.statut).map((x, i) => (
            <Bouton
              key={x.cible}
              variante={i === 0 ? "secondaire" : "discret"}
              icone={x.cible === "fait" ? "succes" : undefined}
              chargement={f.enCours || attente}
              texteChargement="Enregistrement…"
              onClick={() => void changer(x.cible)}
              aria-label={`${x.libelle} : ${t.titre}`}
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
        titreErreur="Changement impossible"
      />
    </li>
  );
}
