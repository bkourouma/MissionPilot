import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { DemandeSignaturePortailApi } from "@missionpilot/shared";
import { NonDisponible } from "../../../../../components/portail/NonDisponible";
import { SignaturePortail } from "../../../../../components/signatures/SignaturePortail";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { estIdentifiant, peut } from "../../../../../lib/portail";
import {
  avancementPortail,
  cheminApiSignaturePortail,
  cheminSignaturePortail,
  CHEMIN_SIGNATURES_PORTAIL,
  libelleMonStatut,
  libelleObjetPortail,
  libelleStatutPortail,
  tonaliteStatutPortail,
} from "../../../../../lib/portail-canaux";
import { chargerPortail, obtenirSessionPortail } from "../../../../../lib/portail-serveur";
import { AVERTISSEMENT_SIGNATURE_SIMULEE, libelleEcheance } from "../../../../../lib/signatures";

export const metadata: Metadata = { title: "Signature" };

/**
 * Une demande de signature de l'espace client : lecture du document, « Signer » ou « Refuser ».
 * L'avancement est donné par des compteurs : jamais le nom d'un membre du cabinet.
 */
export default async function DetailSignaturePortail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.signature.signer")) {
    return <NonDisponible titre="Signature" />;
  }
  const r = await chargerPortail<DemandeSignaturePortailApi>(cheminApiSignaturePortail(id));
  if (!r.ok && r.statut === 404) notFound();
  const retour = { href: CHEMIN_SIGNATURES_PORTAIL, libelle: "Signatures" };
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Signature" retour={retour} />
        <EtatErreur
          titre="La demande n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={cheminSignaturePortail(id)}
        />
      </div>
    );
  }
  const d = r.donnees;
  const etat = libelleMonStatut(d);
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre={libelleObjetPortail(d.objet)}
        retour={retour}
        badges={<BadgeStatut tonalite={etat.tonalite}>{etat.libelle}</BadgeStatut>}
      />
      <Alerte tonalite="attention" annonce="aucune" titre={AVERTISSEMENT_SIGNATURE_SIMULEE}>
        <p>
          Cette signature est un exercice : elle ne remplace ni une signature électronique qualifiée
          ni une signature manuscrite.
        </p>
      </Alerte>
      <Carte titre="Demande" niveauTitre={2}>
        <dl className="mp-liste-def">
          <div>
            <dt>Statut de la demande</dt>
            <dd>
              <BadgeStatut tonalite={tonaliteStatutPortail(d.statut)}>
                {libelleStatutPortail(d.statut)}
              </BadgeStatut>
            </dd>
          </div>
          <div>
            <dt>Avancement</dt>
            <dd>{avancementPortail(d)}</dd>
          </div>
          <div>
            <dt>Échéance</dt>
            <dd>{libelleEcheance(d.expire_le)}</dd>
          </div>
        </dl>
        <SignaturePortail
          signatureId={d.id}
          peutSigner={d.peut_signer}
          peutLire={d.mon_statut !== "en_attente"}
        />
      </Carte>
    </div>
  );
}
