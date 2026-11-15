"use client";

import { api } from "../../lib/api";
import { messageSpecifiqueLangue } from "../../lib/double-authentification";
import { formaterDate } from "../../lib/format";
import {
  cheminStatutUtilisateurPortail,
  libellesRolesPortail,
  messageErreurPortailGestion,
  statutUtilisateurPortail,
  type UtilisateurPortail,
} from "../../lib/portail-gestion";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../formulaires/useAttenteRafraichissement";
import { useFormulaire } from "../formulaires/useFormulaire";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { EtatVide } from "../ui/EtatListe";

export interface UtilisateursPortailProps {
  utilisateurs: readonly UtilisateurPortail[];
  /** Client archivé : la réactivation est refusée par l'API (409). */
  clientActif: boolean;
  /** Politique du portail : la double authentification est exigée. */
  tfaObligatoire: boolean;
}

/** Personnes de l'entreprise cliente qui ont un accès au portail. */
export function UtilisateursPortail({
  utilisateurs,
  clientActif,
  tfaObligatoire,
}: UtilisateursPortailProps) {
  const t = useT();
  if (utilisateurs.length === 0) {
    return (
      <EtatVide
        titre={t(
          "Personne n'a encore accès au portail de ce client.",
          "No one has access to this client's portal yet.",
        )}
        icone="personnes"
      >
        <p>
          {t(
            "Invitez une personne de l'entreprise ci-dessous : elle créera son accès depuis le lien reçu par e-mail.",
            "Invite a person from the company below: they will create their access from the link received by email.",
          )}
        </p>
      </EtatVide>
    );
  }
  return (
    <ul className="mp-liste-cartes">
      {utilisateurs.map((u) => (
        <li key={u.id}>
          <CarteUtilisateurPortail
            utilisateur={u}
            clientActif={clientActif}
            tfaObligatoire={tfaObligatoire}
          />
        </li>
      ))}
    </ul>
  );
}

function BadgeTfa({ active, obligatoire }: { active: boolean; obligatoire: boolean }) {
  const t = useT();
  if (active)
    return (
      <BadgeStatut tonalite="succes">
        {t("Double authentification active", "Two-factor authentication on")}
      </BadgeStatut>
    );
  return obligatoire ? (
    <BadgeStatut tonalite="attention">
      {t("Double authentification à activer", "Two-factor authentication to turn on")}
    </BadgeStatut>
  ) : (
    <BadgeStatut tonalite="neutre">
      {t("Sans double authentification", "No two-factor authentication")}
    </BadgeStatut>
  );
}

function CarteUtilisateurPortail({
  utilisateur: u,
  clientActif,
  tfaObligatoire,
}: {
  utilisateur: UtilisateurPortail;
  clientActif: boolean;
  tfaObligatoire: boolean;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<never>();
  // Après l'action, l'ancien bouton reste affiché jusqu'à l'arrivée du nouveau statut.
  const [attente, attendre] = useAttenteRafraichissement(u.statut);
  const statut = statutUtilisateurPortail(u.statut, langue);
  const actif = u.statut === "actif";

  const changer = (action: "desactiver" | "reactiver") =>
    f.envoyer(
      { ok: true, charge: undefined },
      () => api.post(cheminStatutUtilisateurPortail(u.id, action)),
      {
        succes:
          action === "desactiver"
            ? t(
                `Accès de ${u.nom} désactivé : ses sessions sont fermées.`,
                `Access of ${u.nom} deactivated: their sessions are closed.`,
              )
            : t(`Accès de ${u.nom} réactivé.`, `Access of ${u.nom} reactivated.`),
        messageSpecifique: (e) =>
          messageErreurPortailGestion(
            e,
            action === "desactiver" ? "desactivation" : "reactivation",
            langue,
          ) ?? messageSpecifiqueLangue(langue)(e),
        apres: () => attendre(),
      },
    );

  return (
    <Carte
      // Sous « Accès au portail » (h2) puis « Personnes ayant un accès » (h3).
      niveauTitre={4}
      titre={u.nom}
      actions={
        <span className="mp-badges">
          <BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>
          <BadgeTfa active={u.tfa_active} obligatoire={tfaObligatoire} />
        </span>
      }
    >
      <div className="mp-pile">
        <p className="mp-coupure">{u.email}</p>
        <p className="mp-texte-doux">
          {libellesRolesPortail(u.roles, langue)} · {t("accès créé le", "access created on")}{" "}
          {formaterDate(u.cree_le, "Africa/Abidjan", langue)}
        </p>
        <RetourFormulaire
          erreur={f.erreurGlobale}
          succes={f.succes}
          refAlerte={f.refAlerte}
          titreErreur={t("Modification impossible", "Unable to update")}
        />
        <div className="mp-barre-actions">
          {attente ? (
            <p className="mp-texte-doux" role="status">
              {t("Mise à jour de la liste…", "Updating the list…")}
            </p>
          ) : actif ? (
            <BoutonConfirmation
              libelle={t("Désactiver l'accès", "Deactivate access")}
              ariaLabel={t(
                `Désactiver l'accès de ${u.nom} au portail`,
                `Deactivate the portal access of ${u.nom}`,
              )}
              question={t(
                `Désactiver l'accès de ${u.nom} au portail ? Ses sessions sont fermées immédiatement.`,
                `Deactivate the portal access of ${u.nom}? Their sessions are closed immediately.`,
              )}
              libelleConfirmation={t("Oui, désactiver", "Yes, deactivate")}
              texteChargement={t("Désactivation…", "Deactivating…")}
              action={() => changer("desactiver")}
            />
          ) : clientActif ? (
            <BoutonConfirmation
              libelle={t("Réactiver l'accès", "Reactivate access")}
              ariaLabel={t(
                `Réactiver l'accès de ${u.nom} au portail`,
                `Reactivate the portal access of ${u.nom}`,
              )}
              question={t(
                `Réactiver l'accès de ${u.nom} au portail ? Cette personne retrouvera ce qui est partagé avec son entreprise.`,
                `Reactivate the portal access of ${u.nom}? This person will see again what is shared with their company.`,
              )}
              libelleConfirmation={t("Oui, réactiver", "Yes, reactivate")}
              texteChargement={t("Réactivation…", "Reactivating…")}
              action={() => changer("reactiver")}
            />
          ) : (
            <p className="mp-texte-doux">
              {t(
                "Réactivation impossible tant que la fiche du client est archivée.",
                "Reactivation is not possible while the client profile is archived.",
              )}
            </p>
          )}
        </div>
      </div>
    </Carte>
  );
}
