"use client";

import { api } from "../../lib/api";
import { formaterDate } from "../../lib/format";
import {
  cheminStatutUtilisateurPortail,
  libellesRolesPortail,
  messageErreurPortailGestion,
  statutUtilisateurPortail,
  type UtilisateurPortail,
} from "../../lib/portail-gestion";
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
  if (utilisateurs.length === 0) {
    return (
      <EtatVide titre="Personne n'a encore accès au portail de ce client." icone="personnes">
        <p>
          Invitez une personne de l&apos;entreprise ci-dessous : elle créera son accès depuis le
          lien reçu par e-mail.
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
  if (active) return <BadgeStatut tonalite="succes">Double authentification active</BadgeStatut>;
  return obligatoire ? (
    <BadgeStatut tonalite="attention">Double authentification à activer</BadgeStatut>
  ) : (
    <BadgeStatut tonalite="neutre">Sans double authentification</BadgeStatut>
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
  const f = useFormulaire<never>();
  // Après l'action, l'ancien bouton reste affiché jusqu'à l'arrivée du nouveau statut.
  const [attente, attendre] = useAttenteRafraichissement(u.statut);
  const statut = statutUtilisateurPortail(u.statut);
  const actif = u.statut === "actif";

  const changer = (action: "desactiver" | "reactiver") =>
    f.envoyer(
      { ok: true, charge: undefined },
      () => api.post(cheminStatutUtilisateurPortail(u.id, action)),
      {
        succes:
          action === "desactiver"
            ? `Accès de ${u.nom} désactivé : ses sessions sont fermées.`
            : `Accès de ${u.nom} réactivé.`,
        messageSpecifique: (e) =>
          messageErreurPortailGestion(
            e,
            action === "desactiver" ? "desactivation" : "reactivation",
          ),
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
          {libellesRolesPortail(u.roles)} · accès créé le{" "}
          {formaterDate(u.cree_le, "Africa/Abidjan")}
        </p>
        <RetourFormulaire
          erreur={f.erreurGlobale}
          succes={f.succes}
          refAlerte={f.refAlerte}
          titreErreur="Modification impossible"
        />
        <div className="mp-barre-actions">
          {attente ? (
            <p className="mp-texte-doux" role="status">
              Mise à jour de la liste…
            </p>
          ) : actif ? (
            <BoutonConfirmation
              libelle="Désactiver l'accès"
              ariaLabel={`Désactiver l'accès de ${u.nom} au portail`}
              question={`Désactiver l'accès de ${u.nom} au portail ? Ses sessions sont fermées immédiatement.`}
              libelleConfirmation="Oui, désactiver"
              texteChargement="Désactivation…"
              action={() => changer("desactiver")}
            />
          ) : clientActif ? (
            <BoutonConfirmation
              libelle="Réactiver l'accès"
              ariaLabel={`Réactiver l'accès de ${u.nom} au portail`}
              question={`Réactiver l'accès de ${u.nom} au portail ? Cette personne retrouvera ce qui est partagé avec son entreprise.`}
              libelleConfirmation="Oui, réactiver"
              texteChargement="Réactivation…"
              action={() => changer("reactiver")}
            />
          ) : (
            <p className="mp-texte-doux">
              Réactivation impossible tant que la fiche du client est archivée.
            </p>
          )}
        </div>
      </div>
    </Carte>
  );
}
